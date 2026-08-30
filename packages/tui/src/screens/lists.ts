/**
 * Shared action-list screens (guard / examine / optimize / set): a selectable
 * action list on the left, the latest receipt output (scrollable) on the
 * right. Actions always emit `PendingRun`s executed through the real CLI
 * seams (ADR-0014) — screens never re-implement command semantics.
 */
import { t as translate } from '../i18n.ts'
import type { AppState, InputOwner, PendingRun } from '../types.ts'
import { clampOffset, listBox, panel, splitWidth, type ListEntry } from '../ui/kit.ts'
import { plainLines, seg, theme, type Row } from '../ui/theme.ts'
import { statusLines, type Lang } from '@auto-guard/core'
import { join } from 'node:path'

export interface ActionItem {
  id: string
  label: string
  hint?: string
  danger?: boolean
  /** Ask for inline input before running; `run` receives the submitted value. */
  ask?: { prompt: string; owner: InputOwner; preset?: string }
  /** Open the set-key wizard instead of running a command. */
  wizard?: boolean
  /** Build the pending run; null = cannot run now (reason already rendered). */
  run?: (value: string) => PendingRun | null
}

/** The four list screens' action sets, translated for the current state. */
export function listActions(state: AppState, screen: 'guard' | 'examine' | 'optimize' | 'set'): ActionItem[] {
  const L = state.lang
  const tr = (key: Parameters<typeof translate>[1]) => translate(L, key)
  const root = rootSummary(state)
  const config = root?.config
  const pending = (label: string, argv: string[], busyKey?: PendingRun['busyKey']): PendingRun => ({
    kind: 'mgmt',
    argv,
    label,
    busyKey,
  })
  switch (screen) {
    case 'guard':
      return [
        config?.enabled
          ? { id: 'toggle', label: tr('actToggleOff'), run: () => pending('guard off', ['guard', 'off']) }
          : { id: 'toggle', label: tr('actToggleOn'), run: () => pending('guard on', ['guard', 'on']) },
        { id: 'status', label: tr('actStatus'), run: () => pending('guard status', ['guard', 'status']) },
        { id: 'recent', label: tr('actRecent'), ask: { prompt: tr('inputCount'), owner: 'recent-count', preset: '10' }, run: () => null },
        { id: 'stats', label: tr('actStats'), run: () => pending('guard stats', ['guard', 'stats']) },
        { id: 'report', label: tr('actReport'), ask: { prompt: tr('inputDays'), owner: 'report-days', preset: '7' }, run: () => null },
        { id: 'ping', label: tr('actPing'), run: () => pending('guard ping', ['guard', 'ping'], 'busyPing') },
      ]
    case 'examine':
      return [
        config?.examineEnabled
          ? { id: 'examine-toggle', label: tr('actExamineOff'), run: () => pending('examine off', ['examine', 'off']) }
          : { id: 'examine-toggle', label: tr('actExamineOn'), run: () => pending('examine on', ['examine', 'on']) },
        { id: 'status', label: tr('actExamineStatus'), run: () => pending('examine status', ['examine', 'status']) },
        { id: 'clear-old', label: tr('actClearOld'), run: () => pending('examine clear-old', ['examine', 'clear-old']) },
        { id: 'clear-all', label: tr('actClearAll'), danger: true, run: () => pending('examine clear-all', ['examine', 'clear-all']) },
      ]
    case 'optimize':
      return [
        { id: 'status', label: tr('actOptStatus'), run: () => pending('optimize status', ['optimize', 'status']) },
        { id: 'analyze', label: tr('actAnalyze'), run: () => pending('optimize analyze', ['optimize', 'analyze'], 'busyAnalyze') },
        { id: 'list', label: tr('actOptList'), run: () => pending('optimize list', ['optimize', 'list']) },
        { id: 'rollback', label: tr('actRollback'), danger: true, run: () => pending('optimize rollback', ['optimize', 'rollback']) },
      ]
    case 'set': {
      const nextLang = config?.lang === 'en' ? 'zh' : 'en'
      const actions: ActionItem[] = [
        { id: 'show-key', label: tr('actShowKey'), run: () => pending('set show-key', ['set', 'show-key']) },
        { id: 'set-key', label: tr('actSetKey'), wizard: true },
        { id: 'clear-key', label: tr('actClearKey'), danger: true, run: () => pending('set clear-key', ['set', 'clear-key']) },
        {
          id: 'set-api-base',
          label: tr('actSetApiBase'),
          hint: config?.apiBase,
          ask: { prompt: tr('inputBase'), owner: 'set-api-base', preset: config?.apiBase },
          run: () => null,
        },
        {
          id: 'set-api-model',
          label: tr('actSetApiModel'),
          hint: config?.model,
          ask: { prompt: tr('inputModel'), owner: 'set-api-model', preset: config?.model },
          run: () => null,
        },
        { id: 'set-api-reset', label: tr('actSetApiReset'), run: () => pending('set set-api reset', ['set', 'set-api', 'reset']) },
        {
          id: 'lang',
          label: tr('actLang'),
          hint: config?.lang ?? '—',
          run: () => pending(`set lang ${nextLang}`, ['set', 'lang', nextLang]),
        },
      ]
      if (config?.historyEnabled) {
        actions.push({ id: 'history', label: tr('actHistoryOff'), run: () => pending('set history off', ['set', 'history', 'off']) })
      } else {
        actions.push({ id: 'history', label: tr('actHistoryOn'), run: () => pending('set history on', ['set', 'history', 'on']) })
      }
      actions.push({ id: 'reload', label: tr('actReload'), run: () => pending('set reload', ['set', 'reload']) })
      return actions
    }
  }
}

/** The summary of the currently selected root, if seeded. */
export function rootSummary(state: AppState): AppState['roots'][number] | undefined {
  return state.roots.find((r) => r.root === state.currentRoot && r.seeded)
}

/** Render one list screen: 状态 + 动作 panels (left) | output view (right). */
export function renderListScreen(state: AppState, screen: 'guard' | 'examine' | 'optimize' | 'set'): Row[] {
  const L = state.lang
  const bodyWidth = state.width
  const bodyHeight = state.height - 3
  const { left, right } = splitWidth(bodyWidth)
  const actions = listActions(state, screen)
  const cursor = state.cursor[screen] ?? 0
  const entries: ListEntry[] = actions.map((action) => ({
    text: action.danger ? `⚠ ${action.label}` : action.label,
    hint: action.hint,
    danger: action.danger,
  }))
  // Left column = status panel stacked over the actions panel; its content
  // height yields so the action list always keeps a usable minimum.
  const statusTexts = statusPanelLines(state, screen)
  const statusContent = Math.min(statusTexts.length, Math.max(1, bodyHeight - 7))
  const actionsContent = Math.max(3, bodyHeight - statusContent - 4)
  const statusRows = panel(
    left,
    plainLines(statusTexts, left - 4).map((row) => ({ text: row.map((s) => s.text).join(''), style: row[0]?.style })),
    { title: translate(L, 'statusTitle'), height: statusContent },
  )
  const leftLines = listBox(left - 4, entries, cursor).map((row) => ({ text: row.map((s) => s.text).join(''), style: row[0]?.style }))
  const actionsRows = panel(left, leftLines, { title: translate(L, 'actionsTitle'), height: actionsContent })
  const leftAll = [...statusRows, ...actionsRows]
  const view = state.views[screen] ?? { lines: [], offset: 0 }
  // Clamp here, not just in panel(): the sticky-bottom offset (huge number)
  // must translate to "last page" before slicing (SPEC 0010 regression —
  // unclamped offsets sliced the receipt output to nothing).
  const viewport = Math.max(1, bodyHeight - 2)
  const offset = clampOffset(view.offset, view.lines.length, viewport)
  const visible = view.lines.slice(offset, offset + viewport)
  const rightRows = panel(
    right,
    view.lines.length
      ? visible.map((line) => ({ text: line }))
      : [{ text: translate(L, 'logEmpty'), style: theme.muted }],
    { title: translate(L, 'viewTitle'), height: bodyHeight - 2, scroll: { offset, total: view.lines.length } },
  )
  const composed: Row[] = []
  for (let i = 0; i < Math.max(leftAll.length, rightRows.length); i++) {
    const l = leftAll[i]
    const r = rightRows[i]
    const row: Row = []
    if (l) row.push(...l)
    else row.push(seg(' '.repeat(left)))
    row.push(seg(' ', theme.border))
    if (r) row.push(...r)
    composed.push(row)
  }
  return composed
}

/** Status panel content (structured read, no CLI run) per screen. */
function statusPanelLines(state: AppState, screen: 'guard' | 'examine' | 'optimize' | 'set'): string[] {
  const L = state.lang
  const summary = rootSummary(state)
  if (!summary) return [translate(L, 'needRoot')]
  if (screen === 'guard' || screen === 'set') {
    return statusLines(summary.config!, summary.status ?? {}, join(summary.root, 'config.json'), summary.auditCount, state.lang as Lang)
  }
  const on = (value: boolean | undefined): string => (value ? translate(L, 'chipOn') : translate(L, 'chipOff'))
  const lines = [
    translate(L, 'panelGuard', { state: on(summary.config?.enabled) }),
    translate(L, 'panelExamine', { state: on(summary.config?.examineEnabled) }),
  ]
  if (screen === 'examine') {
    lines.push(translate(L, 'panelHistory', { state: on(summary.config?.historyEnabled) }))
    lines.push(summary.auditCount !== undefined ? translate(L, 'panelCount', { count: summary.auditCount }) : translate(L, 'panelCountOff'))
  }
  if (screen === 'optimize') lines.push(translate(L, 'panelOptimizeHint'))
  return lines
}
