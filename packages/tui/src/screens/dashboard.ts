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
      hint: `${stateChip} · ${keyChip} · ${auditChip}`,
      style: root.root === state.currentRoot ? theme.ok : undefined,
    }
  })
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

/** Dashboard keys: ↑↓ focus, Enter select root, p ping focused seeded root. */
export function dashboardKey(state: AppState, ev: { name: string; ch?: string; ctrl?: boolean }): { patch: Partial<AppState>; effects: Effect[] } {
  const roots = visibleRoots(state)
  if (ev.name === 'up' || ev.ch === 'k') return { patch: { focusRoot: moveCursor(state.focusRoot, -1, roots.length) }, effects: [] }
  if (ev.name === 'down' || ev.ch === 'j') return { patch: { focusRoot: moveCursor(state.focusRoot, 1, roots.length) }, effects: [] }
  const focused = roots[clamp(state.focusRoot, roots.length)]
  if (ev.name === 'enter' && focused?.seeded) {
    return { patch: { currentRoot: focused.root }, effects: [{ type: 'refresh' }] }
  }
  if (ev.ch === 'p' && focused?.seeded) {
    const run: PendingRun = {
      kind: 'mgmt',
      // Explicit --config-root keeps the dashboard ping on the focused root.
      argv: ['guard', 'ping', '--config-root', focused.root],
      label: 'guard ping',
      busyKey: 'busyPing',
    }
    return { patch: {}, effects: [{ type: 'run', run }] }
  }
  return { patch: {}, effects: [] }
}
