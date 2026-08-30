/**
 * Dashboard: one card row per installed host (aggregate `guard status`
 * semantics — seeded roots in full, unseeded hinted, absent skipped), the
 * focused root's status detail, and root selection (SPEC 0009 ticket 04).
 */
import { join } from 'node:path'
import { statusLines, type Lang } from '@auto-guard/core'
import { t } from '../i18n.ts'
import type { AppState, Effect, PendingRun } from '../types.ts'
import { moveCursor } from '../ui/kit.ts'
import { listBox, panel, splitWidth } from '../ui/kit.ts'
import { plainLines, seg, theme, type Row } from '../ui/theme.ts'
import { tildeRoot } from '../paths.ts'

/** Hosts worth showing: installed on this machine (aggregate discipline). */
export function visibleRoots(state: AppState): AppState['roots'] {
  return state.roots.filter((root) => root.installed)
}

/** Language toggle row label (bilingual via actLang); cycles zh ⇄ en. */
export function nextUiLang(lang: AppState['lang']): AppState['lang'] {
  return lang === 'en' ? 'zh' : 'en'
}

export function renderDashboard(state: AppState): Row[] {
  const L = state.lang
  const bodyWidth = state.width
  const bodyHeight = state.height - 3
  const { left, right } = splitWidth(bodyWidth, 0.5)
  const roots = visibleRoots(state)
  const entries = roots.map((root) => {
    const stateChip = !root.seeded ? t(L, 'dashUnseeded') : root.config?.enabled ? t(L, 'chipOn') : t(L, 'chipOff')
    const keyChip = !root.seeded ? '' : root.keyStored ? t(L, 'dashKeyStored') : root.keyEnvName && process.env[root.keyEnvName] ? t(L, 'dashKeyEnv') : t(L, 'dashKeyNone')
    const auditChip = root.auditCount === undefined ? t(L, 'dashExamineOff') : t(L, 'dashExamine', { count: root.auditCount })
    return {
      text: root.label,
      hint: [stateChip, keyChip, auditChip].filter(Boolean).join(' · '),
      style: root.root === state.currentRoot ? theme.ok : undefined,
    }
  })
  // Last row = language toggle (SPEC 0011 follow-up): Enter cycles zh ⇄ en.
  entries.push({ text: t(L, 'actLang'), hint: `${L} ⇄ ${nextUiLang(L)}`, style: undefined })
  const listHeight = Math.max(3, bodyHeight - 4)
  const listLines = listBox(left - 4, entries, clamp(state.focusRoot, entries.length)).map((row) => ({
    text: row.map((s) => s.text).join(''),
    style: row[0]?.style,
  }))
  const leftRows = panel(left, listLines, { title: t(L, 'dashTitle'), height: listHeight })
  const focused = roots[clamp(state.focusRoot, entries.length)]
  const detailLines: string[] = focused
    ? focused.seeded && focused.config
      ? [
          `${focused.root === state.currentRoot ? `★ ${t(L, 'dashCurrent')}` : t(L, 'dashSetCurrent')} — ${tildeRoot(focused.root)}`,
          ...statusLines(focused.config, focused.status ?? {}, join(focused.root, 'config.json'), focused.auditCount, state.lang as Lang),
        ]
      : [`${focused.label} — ${tildeRoot(focused.root)}`, t(L, 'dashUnseededDetail')]
    : [t(L, 'noRoot')]
  const rightLines = plainLines(detailLines, right - 2).map((row) => ({ text: row.map((s) => s.text).join('') }))
  const rightRows = panel(right, rightLines, { title: focused?.label ?? '', height: listHeight })
  const rows: Row[] = []
  for (let i = 0; i < Math.max(leftRows.length, rightRows.length); i++) {
    const l = leftRows[i]
    const r = rightRows[i]
    const row: Row = []
    if (l) row.push(...l)
    else row.push(seg(' '.repeat(left)))
    row.push(seg(' ', theme.border))
    if (r) row.push(...r)
    rows.push(row)
  }
  return rows
}

function clamp(index: number, length: number): number {
  return length <= 0 ? 0 : Math.min(index, length - 1)
}

/** Dashboard keys: ↑↓ focus (hosts + language row), Enter select/toggle,
 * p ping focused seeded root. */
export function dashboardKey(state: AppState, ev: { name: string; ch?: string; ctrl?: boolean }): { patch: Partial<AppState>; effects: Effect[] } {
  const roots = visibleRoots(state)
  // Host cards plus the trailing language-toggle row (SPEC 0011 follow-up).
  const rows = roots.length + 1
  if (ev.name === 'up' || ev.ch === 'k') return { patch: { focusRoot: moveCursor(state.focusRoot, -1, rows) }, effects: [] }
  if (ev.name === 'down' || ev.ch === 'j') return { patch: { focusRoot: moveCursor(state.focusRoot, 1, rows) }, effects: [] }
  const index = clamp(state.focusRoot, rows)
  if (index >= roots.length) {
    // Language row: toggle through the same `set lang` seam (single source).
    if (ev.name === 'enter' || ev.name === 'space') {
      const next = nextUiLang(state.lang)
      return { patch: {}, effects: [{ type: 'run', run: { kind: 'mgmt', argv: ['set', 'lang', next], label: `set lang ${next}`, busyKey: 'busyRefresh' } }] }
    }
    return { patch: {}, effects: [] }
  }
  const focused = roots[index]
  if (ev.name === 'enter' && focused?.seeded) {
    return { patch: { currentRoot: focused.root, notice: t(state.lang, 'noticeRoot', { root: focused.label }) }, effects: [{ type: 'refresh' }] }
  }
  if (ev.ch === 'p' && focused?.seeded) {
    const run: PendingRun = {
      kind: 'mgmt',
      // Out-of-band root keeps the ping on the FOCUSED root while argv stays
      // the user-visible command (SPEC 0011).
      argv: ['guard', 'ping'],
      root: focused.root,
      label: 'guard ping',
      busyKey: 'busyPing',
    }
    return { patch: {}, effects: [{ type: 'run', run }] }
  }
  return { patch: {}, effects: [] }
}
