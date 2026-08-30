/**
 * Pure render components (SPEC 0009 ticket 02). Every function takes plain
 * data + a width and returns styled rows — no I/O, no globals — so the whole
 * UI can be snapshot-tested without a terminal (ADR-0014).
 */
import type { KeyEvent } from '../keys.ts'
import { fitToWidth, padToWidth, textWidth, truncateToWidth, wrapToWidth } from './text.ts'
import { seg, theme, type Row, type Style } from './theme.ts'

// ---------- shared helpers ----------

export function rowWidth(row: Row): number {
  return row.reduce((sum, s) => sum + textWidth(s.text), 0)
}

/** Row plain text (assertions / measurements). */
export function rowText(row: Row): string {
  return row.map((s) => s.text).join('')
}

function truncateRow(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const s of row) {
    if (used >= width) break
    const room = width - used
    out.push(seg(truncateToWidth(s.text, room, ''), s.style))
    used += textWidth(out[out.length - 1]!.text)
  }
  return out
}

// ---------- header / nav / footer ----------

export interface HeaderChip {
  text: string
  style: Style
}

/** Powerline-style header: bg-colored chips separated by spaces. */
export function headerBar(width: number, chips: readonly HeaderChip[]): Row {
  const row: Row = []
  for (let i = 0; i < chips.length; i++) {
    const candidate = i === 0 ? [seg(` ${chips[i]!.text} `, chips[i]!.style)] : [seg(' '), seg(` ${chips[i]!.text} `, chips[i]!.style)]
    if (rowWidth(row) + rowWidth(candidate) > width) break
    row.push(...candidate)
  }
  return row
}

export interface NavTab {
  label: string
  key: string
}

/** Tab row: active tab on an accent pill, inactive tabs muted (SPEC 0010). */
export function navTabs(width: number, tabs: readonly NavTab[], active: number): Row {
  const row: Row = [seg(' ')]
  tabs.forEach((tab, i) => {
    if (i > 0) row.push(seg(' '))
    const text = ` ${tab.key} ${tab.label} `
    row.push(seg(text, i === active ? theme.accentBg : theme.muted))
  })
  return truncateRow(row, width)
}

export interface FooterReceipt {
  code: number
  argv: string
}

/**
 * Footer: keycap-style hints (left, keys bright / labels dim) + busy spinner
 * or last receipt (right). The left side is a pre-composed Row so the app can
 * swap in a transient notice (SPEC 0010).
 */
export function footerBar(width: number, left: Row, receipt: FooterReceipt | null, busyLabel: string | null, tick: number): Row {
  let right = ''
  let rightStyle: Style = theme.muted
  if (busyLabel) {
    right = `${SPINNER[tick % SPINNER.length]} ${busyLabel}`
    rightStyle = theme.warn
  } else if (receipt) {
    const mark = receipt.code === 0 ? '✓' : '✗'
    right = `${mark} ${receipt.argv.split(' ').slice(0, 3).join(' ')} → ${receipt.code}`
    rightStyle = receipt.code === 0 ? theme.ok : theme.danger
  }
  const leftWidth = rowWidth(left)
  const cutLeft = leftWidth > width - textWidth(right) - 2 ? truncateRow(left, Math.max(1, width - textWidth(right) - 2)) : left
  const gap = Math.max(1, width - rowWidth(cutLeft) - textWidth(right))
  const row: Row = [...cutLeft, seg(' '.repeat(gap))]
  if (right) row.push(seg(right, rightStyle))
  return row
}

/** One keycap hint pair: bright key + dim label. */
export function keyHint(key: string, label: string): Row {
  return [seg(key, theme.bold), seg(` ${label}`, theme.muted)]
}

/** Join hint rows with dim separators and lead/trail padding. */
export function hintRow(hints: readonly Row[], leading = ' '): Row {
  const row: Row = [seg(leading)]
  hints.forEach((hint, i) => {
    if (i > 0) row.push(seg(' · ', theme.muted))
    row.push(...hint)
  })
  return row
}

// ---------- panel / list / scroll ----------

export interface PanelLine {
  text: string
  style?: Style
}

export interface PanelOptions {
  title?: string
  border?: 'normal' | 'accent' | 'danger'
  /** Fixed content height; padded/truncated to exactly this many rows. */
  height?: number
  /** Scrollbar gutter on the right edge: window offset + total lines. */
  scroll?: { offset: number; total: number }
}

/** Clamp a scroll offset into [0, total-viewport]; huge offsets = bottom. */
export function clampOffset(offset: number, total: number, viewport: number): number {
  return Math.min(Math.max(0, offset), Math.max(0, total - viewport))
}

/**
 * Fold pane content to the content width (SPEC 0011): wide lines wrap into
 * continuation rows that inherit the source style — nothing is silently cut.
 * Panes wrap BEFORE offset clamping, so sticky-bottom and the scroll gutter
 * stay correct when folding grows the total.
 */
export function wrapPanelLines(lines: readonly PanelLine[], width: number): PanelLine[] {
  return lines.flatMap((line) => wrapToWidth(line.text, width).map((part) => ({ text: part, style: line.style })))
}

/** Bordered panel with optional title; content fitted to inner width. */
export function panel(width: number, lines: readonly PanelLine[], opts: PanelOptions = {}): Row[] {
  const borderStyle = opts.border === 'danger' ? theme.borderDanger : opts.border === 'accent' ? theme.borderAccent : theme.border
  const inner = Math.max(3, width - 2)
  const title = opts.title ? `─ ${opts.title} ` : ''
  const rows: Row[] = [[seg(`╭${title}${'─'.repeat(Math.max(0, inner - textWidth(title)))}╮`, borderStyle)]]
  const rowsNeeded = opts.height ?? lines.length
  const contentWidth = opts.scroll ? inner - 2 : inner
  // Offsets beyond the end clamp to "bottom" (run-done sticks to bottom).
  const scrollOffset = opts.scroll ? Math.min(opts.scroll.offset, Math.max(0, opts.scroll.total - rowsNeeded)) : 0
  for (let i = 0; i < rowsNeeded; i++) {
    const line = lines[i]
    let text: string
    let style: Style | undefined
    if (!line) {
      text = ' '.repeat(inner)
    } else {
      const fitted = fitToWidth(line.text, contentWidth)
      style = line.style
      if (opts.scroll) {
        // Gutter shows an indicator only on the first row; blank when the
        // content fits — a full-height bar reads as a double border.
        const bar = i === 0 ? scrollBarTop(scrollOffset, rowsNeeded, opts.scroll.total) : ' '
        text = padToWidth(fitted, contentWidth) + ` ${bar}`
      } else {
        text = padToWidth(fitted, inner)
      }
    }
    rows.push([seg('│', borderStyle), seg(text, style), seg('│', borderStyle)])
  }
  rows.push([seg(`╰${'─'.repeat(inner)}╯`, borderStyle)])
  return rows
}

function scrollBarTop(offset: number, viewport: number, total: number): string {
  if (total <= viewport) return ' '
  const clamped = Math.min(Math.max(0, offset), Math.max(0, total - viewport))
  const ratio = clamped / Math.max(1, total - viewport)
  return ratio <= 0 ? '↑' : ratio >= 1 ? '↓' : '┃'
}

export interface ListEntry {
  text: string
  hint?: string
  style?: Style
  danger?: boolean
  /** Group heading: rendered as a title row, never carries the cursor. */
  header?: boolean
}

/** Selectable list with `❯ ` cursor; entries may carry a trailing hint. */
export function listBox(width: number, entries: readonly ListEntry[], cursor: number): Row[] {
  return entries.map((entry, i) => {
    if (entry.header) return [{ text: fitToWidth(`  ${entry.text}`, width), style: theme.title }] as Row
    const marker = i === cursor ? '❯ ' : '  '
    const hintText = entry.hint ? `  ${entry.hint}` : ''
    const text = fitToWidth(`${marker}${entry.text}${hintText}`, width)
    const style = i === cursor ? theme.selected : entry.danger ? theme.danger : entry.style
    return [{ text, style }] as Row
  })
}

/** Move a list cursor with wrap-around. */
export function moveCursor(current: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return (current + delta + length) % length
}

// ---------- checkbox list (installer) ----------

export interface CheckEntry {
  text: string
  detail?: string
  checked: boolean
  locked?: boolean
}

/** Checkbox rows: `❯ [x] ZCode — evidence`; locked rows dim. */
export function checkList(width: number, entries: readonly CheckEntry[], cursor: number): Row[] {
  return entries.map((entry, i) => {
    const marker = i === cursor ? '❯' : ' '
    const box = entry.checked ? '[x]' : '[ ]'
    const detail = entry.detail ? ` ${entry.detail}` : ''
    const text = fitToWidth(`${marker} ${box} ${entry.text}${detail}`, width)
    const style = entry.locked ? theme.muted : i === cursor ? theme.selected : undefined
    return [{ text, style }] as Row
  })
}

// ---------- confirm dialog ----------

export interface ConfirmModel {
  message: string[]
  danger: boolean
  /** Cursor position: false = no/cancel (default), true = yes/confirm. */
  confirmFocused: boolean
  yesLabel: string
  noLabel: string
}

/** Modal confirm box centered over the base frame (backdrop preserved). */
export function confirmDialog(base: readonly Row[], width: number, model: ConfirmModel): Row[] {
  const longest = model.message.reduce((max, line) => Math.max(max, textWidth(line)), 0)
  const boxWidth = Math.min(width - 4, Math.max(32, longest + 6))
  const inner = Math.max(10, boxWidth - 2)
  const border = model.danger ? theme.borderDanger : theme.borderAccent
  const box: Row[] = [[seg(`╭${'─'.repeat(inner)}╮`, border)]]
  for (const message of model.message) {
    box.push([seg('│', border), seg(padToWidth(truncateToWidth(message, inner), inner)), seg('│', border)])
  }
  box.push([seg(`│${' '.repeat(inner)}│`, border)])
  const yes = ` ${model.yesLabel} `
  const no = ` ${model.noLabel} `
  const padTotal = Math.max(0, inner - textWidth(yes) - textWidth(no) - 1)
  const leftPad = Math.floor(padTotal / 2)
  const rightPad = padTotal - leftPad
  const yesSeg = seg(yes, model.confirmFocused ? (model.danger ? theme.dangerBg : theme.accentBg) : theme.muted)
  const noSeg = seg(no, model.confirmFocused ? theme.muted : theme.selected)
  const buttonSegs: Row = [seg('│', border), seg(' '.repeat(leftPad)), yesSeg, seg(' '), noSeg, seg(' '.repeat(rightPad)), seg('│', border)]
  box.push(buttonSegs, [seg(`╰${'─'.repeat(inner)}╯`, border)])
  return overlayCentered(base, width, box)
}

/** Overlay a box on the base frame, centered; base rows outside are kept. */
export function overlayCentered(base: readonly Row[], width: number, box: readonly Row[]): Row[] {
  const height = Math.max(base.length, box.length)
  const top = Math.max(0, Math.floor((height - box.length) / 2))
  const out: Row[] = []
  for (let y = 0; y < height; y++) {
    const baseRow = base[y] ?? [{ text: '' }]
    if (y < top || y >= top + box.length) {
      out.push(baseRow)
      continue
    }
    const boxRow = box[y - top]!
    const left = Math.max(0, Math.floor((width - rowWidth(boxRow)) / 2))
    const right = Math.max(0, width - left - rowWidth(boxRow))
    out.push([seg(' '.repeat(left)), ...boxRow, ...(right > 0 ? [seg(' '.repeat(right))] : [])])
  }
  return out
}

// ---------- inline input ----------

export interface InputModel {
  value: string
  /** Caret position in code points, 0..value.length. */
  cursor: number
  masked: boolean
}

export const emptyInput = (masked = false): InputModel => ({ value: '', cursor: 0, masked })

/** Pure input state transition. */
export function inputKey(model: InputModel, ev: KeyEvent): InputModel {
  const chars = [...model.value]
  const { cursor } = model
  switch (ev.name) {
    case 'char':
      if (!ev.ch || ev.ctrl || ev.meta) return model
      chars.splice(cursor, 0, ev.ch)
      return { ...model, value: chars.join(''), cursor: cursor + 1 }
    case 'space':
      chars.splice(cursor, 0, ' ')
      return { ...model, value: chars.join(''), cursor: cursor + 1 }
    case 'backspace':
      if (cursor === 0) return model
      chars.splice(cursor - 1, 1)
      return { ...model, value: chars.join(''), cursor: cursor - 1 }
    case 'delete':
      if (cursor >= chars.length) return model
      chars.splice(cursor, 1)
      return { ...model, value: chars.join('') }
    case 'left':
      return { ...model, cursor: Math.max(0, cursor - 1) }
    case 'right':
      return { ...model, cursor: Math.min(chars.length, cursor + 1) }
    case 'home':
      return { ...model, cursor: 0 }
    case 'end':
      return { ...model, cursor: chars.length }
    default:
      return model
  }
}

/** Visible form: masked dots + a block caret at the editing position. */
export function inputDisplay(model: InputModel, width: number): string {
  const shown = model.masked ? '•'.repeat([...model.value].length) : model.value
  const chars = [...shown]
  const at = Math.min(model.cursor, chars.length)
  chars.splice(at, 0, '▌')
  return truncateToWidth(chars.join(''), Math.max(1, width))
}

/** A one-line input row: `prompt: value▌` fitted to width. */
export function inputRow(prompt: string, model: InputModel, width: number): Row {
  // A prompt ending in ':' already carries its own separator (command mode).
  const promptSeg = seg(prompt.endsWith(':') ? `${prompt} ` : `${prompt}: `, theme.bold)
  const room = Math.max(1, width - textWidth(promptSeg.text))
  return [promptSeg, seg(inputDisplay(model, room))]
}

// ---------- spinner ----------

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

export function spinnerRow(label: string, tick: number): Row {
  return [seg(`${SPINNER[tick % SPINNER.length]} ${label}`, theme.warn)]
}

// ---------- layout helpers ----------

/** Fit a frame to exactly height×width: pad short rows, cut long ones. */
export function padFrame(frame: readonly Row[], width: number, height: number): Row[] {
  const out: Row[] = []
  for (let y = 0; y < height; y++) {
    const row = frame[y]
    if (!row) {
      out.push([{ text: '' }])
      continue
    }
    const cut = truncateRow(row, width)
    const gap = width - rowWidth(cut)
    out.push(gap > 0 ? [...cut, seg(' '.repeat(gap))] : cut)
  }
  return out
}

/** Two-column split of a body width (left list, right detail). */
export function splitWidth(width: number, leftRatio = 0.42): { left: number; right: number } {
  const left = Math.max(26, Math.min(width - 28, Math.floor(width * leftRatio)))
  const right = Math.max(10, width - left - 1)
  return { left, right }
}

/** Vertical separator column between split panes. */
export function separatorColumn(height: number): Row[] {
  return Array.from({ length: height }, () => [seg('│', theme.border)] as Row)
}
