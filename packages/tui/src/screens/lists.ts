/**
 * Shared action-list screens (guard / examine / optimize / set): a selectable
 * action list on the left, the latest receipt output (scrollable) on the
 * right. Actions always emit `PendingRun`s executed through the real CLI
 * seams (ADR-0014) — screens never re-implement command semantics.
 */
import { t as translate } from '../i18n.ts'
import type { AppState, InputOwner, PendingRun } from '../types.ts'
import { listBox, panel, splitWidth, type ListEntry } from '../ui/kit.ts'
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

/** Render one list screen: status strip + action list | output view. */
export function renderListScreen(state: AppState, screen: 'guard' | 'examine' | 'optimize' | 'set'): Row[] {
  const L = state.lang
  const bodyWidth = state.width
  const bodyHeight = state.height - 3
  const { left, right } = splitWidth(bodyWidth)
  const actions = listActions(state, screen)
  const cursor = state.cursor[screen] ?? 0
  const entries: ListEntry[] = actions.map((action) => ({
    text: action.label,
    hint: action.hint,
    danger: action.danger,
  }))
  const strip = plainLines(statusStrip(state, screen), bodyWidth)
  const panelHeight = Math.max(3, bodyHeight - strip.length - 2)
  const leftLines = listBox(left - 4, entries, cursor).map((row) => ({ text: row.map((s) => s.text).join(''), style: row[0]?.style }))
  const leftRows = panel(left, leftLines, { height: panelHeight })
  const view = state.views[screen] ?? { lines: [], offset: 0 }
  const visible = view.lines.slice(view.offset, view.offset + Math.max(1, panelHeight))
  const rightRows = panel(
    right,
    view.lines.length
      ? visible.map((line) => ({ text: line }))
      : [{ text: translate(L, 'logEmpty'), style: theme.muted }],
    { title: translate(L, 'viewTitle'), height: panelHeight, scroll: { offset: view.offset, total: view.lines.length } },
  )
  const composed: Row[] = [...strip]
  for (let i = 0; i < Math.max(leftRows.length, rightRows.length); i++) {
    const l = leftRows[i]
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

/** Compact status strip reused by list screens (guard/examine/set). */
function statusStrip(state: AppState, screen: 'guard' | 'examine' | 'optimize' | 'set'): string[] {
  const summary = rootSummary(state)
  if (!summary) return [translate(state.lang, 'needRoot')]
  if (screen === 'guard' || screen === 'set') {
    return statusLines(summary.config!, summary.status ?? {}, join(summary.root, 'config.json'), summary.auditCount, state.lang as Lang)
  }
  return []
}
