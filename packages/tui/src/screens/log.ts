/**
 * Log screen: flat scrollback of every receipt — `❯ argv`, indented output,
 * exit-code footer line (SPEC 0009 ticket 03). The `:` command mode is the
 * universal full-coverage channel; everything it runs lands here too.
 */
import { t } from '../i18n.ts'
import type { AppState } from '../types.ts'
import { clampOffset, panel, wrapPanelLines } from '../ui/kit.ts'
import { theme, type Row, type Style } from '../ui/theme.ts'

/** Flatten receipts into scrollback lines (oldest first, newest at bottom). */
export function logLines(state: AppState): { text: string; style?: Style }[] {
  const lines: { text: string; style?: Style }[] = []
  for (const receipt of state.receipts) {
    lines.push({ text: `❯ ${receipt.argv}` })
    for (const out of receipt.output) lines.push({ text: `  ${out}`, style: theme.muted })
    lines.push({
      text: `  ↳ exit ${receipt.code}`,
      style: receipt.code === 0 ? theme.ok : theme.danger,
    })
    lines.push({ text: '' })
  }
  return lines
}

export function renderLog(state: AppState): Row[] {
  const L = state.lang
  const view = state.views.log ?? { lines: [], offset: 0 }
  const lines = logLines(state)
  const height = Math.max(3, state.height - 5)
  // Wrap before clamping (SPEC 0011): continuation rows keep the source
  // style, so styled output folds instead of being cut at the pane edge.
  const wrapped = wrapPanelLines(lines, Math.max(1, state.width - 4))
  const offset = clampOffset(view.offset, wrapped.length, height)
  const visible = wrapped.slice(offset, offset + height)
  return panel(
    state.width,
    lines.length
      ? visible
      : [{ text: t(L, 'logEmpty'), style: theme.muted }],
    { title: t(L, 'logTitle'), height, scroll: { offset, total: wrapped.length } },
  )
}

/**
 * Scroll an offset by ±delta, clamped into [0, total-viewport]. `total` is
 * the FOLDED row count (SPEC 0011): raw line counts would dead-stop paging
 * whenever raw lines fit one screen but folded ones do not.
 */
export function scrollBy(offset: number, delta: number, total: number, viewport: number): number {
  const max = Math.max(0, total - viewport)
  return Math.min(max, Math.max(0, offset + delta))
}
