/**
 * Installer screen (SPEC 0009 ticket 06): Init (detect → multi-select →
 * rule-update choice → preview → confirm → apply), Status (`list`), Remove
 * (integrated hosts → confirm). Applies run through `runInstallerCommand`
 * with explicit `--host/--yes/--(update|skip)-rules` — the CLI's own line
 * confirmations are replaced by the TUI's preview + dialog (equivalent
 * safety, SPEC 0002 diff-before-write preserved).
 *
 * Deviation from SPEC ticket 06 wording (recorded in handoff): undetected
 * hosts are **not** manually checkable — the CLI's `--host` path rejects
 * undetected hosts (fail-closed), and its manual-confirm path needs the
 * readline terminal the TUI owns. Undetected rows render locked instead.
 */
import { integrationStatus } from '@auto-guard/cli/installer/integration'
import type { DetectionResult } from '@auto-guard/cli/installer/detect'
import { resolvePackagePaths } from '@auto-guard/cli/installer'
import type { HostId } from '@auto-guard/cli/installer/profiles'
import { t } from '../i18n.ts'
import type { AppState, DialogState, Effect, IntegratedDetection } from '../types.ts'
import { buildInitArgv, buildPreview, buildRemoveArgv, saveMachineLangSafe } from '../actions.ts'
import { checkList, clampOffset, moveCursor, panel, splitWidth, wrapPanelLines } from '../ui/kit.ts'
import { seg, theme, type Row } from '../ui/theme.ts'

type RowKind = 'host' | 'lang' | 'rules' | 'apply' | 'list' | 'remove-host' | 'remove-apply'

interface InstallerRow {
  kind: RowKind
  hostId?: HostId
  text: string
  detail?: string
  checked?: boolean
  locked?: boolean
  danger?: boolean
  /** Radio value for rules / language rows. */
  value?: 'update' | 'skip'
}

/** Flat selectable row model for the current tab (render + keys share it). */
export function installerRows(state: AppState): InstallerRow[] {
  const L = state.lang
  const inst = state.installer
  const rows: InstallerRow[] = []
  if (inst.tab === 'init') {
    rows.push({ kind: 'lang', text: t(L, 'instLangPrompt'), detail: L === 'en' ? 'English' : '中文', locked: !inst.langAsked })
    for (const detection of inst.detections) {
      const integrated = detection.integrated === 'integrated'
      rows.push({
        kind: 'host',
        hostId: detection.profile.id,
        text: detection.profile.label.replace(/ Coding Agent$/, ''),
        detail: integrated ? t(L, 'instIntegrated') : detection.detected ? detection.evidence.join(', ') : t(L, 'instNotDetected'),
        checked: Boolean(inst.checked[detection.profile.id]),
        // Fail-closed: the CLI's --host path rejects undetected hosts and the
        // manual-confirm path needs the readline terminal the TUI owns.
        locked: integrated || !detection.detected,
      })
    }
    rows.push({ kind: 'rules', text: t(L, 'instRulesUpdate'), checked: inst.rulesChoice === 'update', value: 'update' })
    rows.push({ kind: 'rules', text: t(L, 'instRulesSkip'), checked: inst.rulesChoice === 'skip', value: 'skip' })
    rows.push({ kind: 'apply', text: `▶ ${t(L, 'instApply')}`, danger: true })
    return rows
  }
  if (inst.tab === 'status') {
    rows.push({ kind: 'list', text: `▶ ${t(L, 'instTabStatus')} (auto-guard list)` })
    return rows
  }
  for (const detection of inst.detections) {
    if (detection.integrated !== 'integrated') continue
    rows.push({
      kind: 'remove-host',
      hostId: detection.profile.id,
      text: detection.profile.label.replace(/ Coding Agent$/, ''),
      checked: Boolean(inst.removeChecked[detection.profile.id]),
    })
  }
  rows.push({ kind: 'remove-apply', text: `▶ ${t(L, 'instTabRemove')}`, danger: true })
  return rows
}

/** Enrich detections with integration status (list/remove tabs render it). */
export function withIntegration(detections: readonly DetectionResult[], home: string): IntegratedDetection[] {
  const paths = resolvePackagePaths()
  return detections.map((detection) => ({
    ...detection,
    integrated: integrationStatus(detection.profile.id, { home, paths }),
  }))
}
export function renderInstaller(state: AppState): Row[] {
  const L = state.lang
  const bodyHeight = state.height - 3
  const { left, right } = splitWidth(state.width, 0.5)
  const inst = state.installer
  const rows = installerRows(state)
  const tabs = [t(L, 'instTabInit'), t(L, 'instTabStatus'), t(L, 'instTabRemove')].map((label, i) =>
    seg(inst.tab === ['init', 'status', 'remove'][i] ? ` ${label} ` : ` ${label} `, inst.tab === ['init', 'status', 'remove'][i] ? theme.accentBg : theme.muted),
  )
  const tabRow: Row = [seg(' '), ...tabs.flatMap((s, i) => (i > 0 ? [seg(' '), s] : [s]))]
  const checkEntries = rows.map((row) => ({
    text: row.text,
    detail: row.detail,
    checked: row.checked === true,
    locked: row.locked,
  }))
  const hint = inst.tab === 'init' ? t(L, 'instSelectHosts') : inst.tab === 'remove' ? t(L, 'instRemoveSelect') : t(L, 'instTabStatus')
  const leftLines = [
    { text: hint, style: theme.muted },
    ...checkList(left - 4, checkEntries, inst.cursor).map((row) => ({ text: row.map((s) => s.text).join(''), style: row[0]?.style })),
  ]
  const leftRows = panel(left, leftLines, { title: t(L, 'instTitle'), height: Math.max(3, bodyHeight - 2) })
  const view = state.views.installer ?? { lines: [], offset: 0 }
  const height = Math.max(3, bodyHeight - 2)
  // Wrap before clamping (SPEC 0011): folded long diff lines keep the
  // sticky-bottom offset and scroll gutter correct.
  const wrapped = wrapPanelLines(view.lines.map((line) => ({ text: line })), Math.max(1, right - 4))
  const offset = clampOffset(view.offset, wrapped.length, height)
  const visible = wrapped.slice(offset, offset + height)
  const rightRows = panel(
    right,
    view.lines.length ? visible : [{ text: t(L, 'instPreviewTitle'), style: theme.muted }],
    { title: t(L, 'instPreviewTitle'), height, scroll: { offset, total: wrapped.length } },
  )
  const body: Row[] = [tabRow]
  for (let i = 0; i < Math.max(leftRows.length, rightRows.length); i++) {
    const l = leftRows[i]
    const r = rightRows[i]
    const row: Row = []
    if (l) row.push(...l)
    else row.push(seg(' '.repeat(left)))
    row.push(seg(' ', theme.border))
    if (r) row.push(...r)
    body.push(row)
  }
  return body
}

/** Installer keys: Tab/Shift+Tab sub-tabs, ↑↓ cursor, Space toggle, Enter activate. */
export function installerKey(state: AppState, ev: { name: string; ch?: string; shift?: boolean }): { patch: Partial<AppState>; effects: Effect[]; dialog?: DialogState; preview?: string[] } {
  const inst = state.installer
  const patch: Partial<AppState> = {}
  const order = ['init', 'status', 'remove'] as const
  if (ev.name === 'tab') {
    const index = order.indexOf(inst.tab)
    const next = ev.shift ? (index + order.length - 1) % order.length : (index + 1) % order.length
    return { patch: { installer: { ...inst, tab: order[next]!, cursor: 0 } }, effects: [] }
  }
  const rows = installerRows(state)
  if (ev.name === 'up' || ev.ch === 'k') return { patch: { installer: { ...inst, cursor: moveCursor(inst.cursor, -1, rows.length) } }, effects: [] }
  if (ev.name === 'down' || ev.ch === 'j') return { patch: { installer: { ...inst, cursor: moveCursor(inst.cursor, 1, rows.length) } }, effects: [] }
  const row = rows[inst.cursor]
  if (!row) return { patch, effects: [] }
  const toggleOrActivate = ev.name === 'space' || ev.name === 'enter'
  if (row.kind === 'host' && !row.locked && toggleOrActivate) {
    return { patch: { installer: { ...inst, checked: { ...inst.checked, [row.hostId!]: !row.checked } } }, effects: [] }
  }
  if (row.kind === 'lang' && toggleOrActivate && !row.locked) {
    const next = state.lang === 'en' ? 'zh' : 'en'
    return { patch: { lang: next, installer: { ...inst } }, effects: [] }
  }
  if (row.kind === 'rules' && toggleOrActivate) {
    return { patch: { installer: { ...inst, rulesChoice: row.value === 'update' ? 'update' : 'skip' } }, effects: [] }
  }
  if (row.kind === 'list' && ev.name === 'enter') {
    return { patch, effects: [{ type: 'run', run: { kind: 'inst', argv: ['list'], label: 'list' } }] }
  }
  if (row.kind === 'remove-host' && toggleOrActivate) {
    return { patch: { installer: { ...inst, removeChecked: { ...inst.removeChecked, [row.hostId!]: !row.checked } } }, effects: [] }
  }
  if (row.kind === 'remove-apply' && ev.name === 'enter') {
    const targets = Object.entries(inst.removeChecked).filter(([, on]) => on).map(([id]) => id as HostId)
    if (!targets.length) return { patch: { notice: t(state.lang, 'instNoneChecked') }, effects: [] }
    const dialog: DialogState = {
      message: [t(state.lang, 'confirmRemove')],
      danger: true,
      confirmFocused: false,
      yesLabel: t(state.lang, 'confirmYes'),
      noLabel: t(state.lang, 'confirmNo'),
      pending: { kind: 'inst', argv: buildRemoveArgv(targets), label: 'remove', busyKey: 'busyRemove' },
    }
    return { patch, effects: [], dialog }
  }
  if (row.kind === 'apply' && ev.name === 'enter') {
    const checked = rows.filter((r) => r.kind === 'host' && r.checked).map((r) => r.hostId!) as HostId[]
    if (!checked.length) {
      return { patch: { notice: t(state.lang, 'instNoneChecked') }, effects: [] }
    }
    const rules = inst.rulesChoice === 'update' ? 'update' : 'skip'
    // First apply persists the language choice as the machine default so the
    // question never repeats (ADR-0011) — one small sync write.
    if (inst.langAsked) saveMachineLangSafe(state.lang)
    const preview = buildPreview({}, checked, rules, state.lang)
    const dialog: DialogState = {
      message: [t(state.lang, 'confirmApply')],
      danger: false,
      confirmFocused: false,
      yesLabel: t(state.lang, 'confirmYes'),
      noLabel: t(state.lang, 'confirmNo'),
      pending: { kind: 'inst', argv: buildInitArgv(checked, rules, state.lang), label: 'init', busyKey: 'busyInstall' },
    }
    return { patch: { installer: { ...inst } }, effects: [], dialog, preview }
  }
  return { patch, effects: [] }
}
