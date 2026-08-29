/**
 * Log screen: flat scrollback of every receipt — `❯ argv`, indented output,
 * exit-code footer line (SPEC 0009 ticket 03). The `:` command mode is the
 * universal full-coverage channel; everything it runs lands here too.
 */
import { t } from '../i18n.ts'
import type { AppState } from '../types.ts'
import { panel } from '../ui/kit.ts'
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
  const visible = lines.slice(view.offset, view.offset + height)
  return panel(
    state.width,
    lines.length
      ? visible.map((line) => ({ text: line.text, style: line.style }))
      : [{ text: t(L, 'logEmpty'), style: theme.muted }],
    { title: t(L, 'logTitle'), height, scroll: { offset: view.offset, total: lines.length } },
  )
}

/** Scroll keys shared by log view: ↑↓ half-screen via PgUp/PgDn, g/G ends. */
export function scrollBy(current: { lines: string[]; offset: number }, delta: number, viewport: number): number {
  const max = Math.max(0, current.lines.length - viewport)
  return Math.min(max, Math.max(0, current.offset + delta))
}
