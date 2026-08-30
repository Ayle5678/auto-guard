/**
 * Color palette and SGR emission (ADR-0014). Styled text is a `Seg` — plain
 * text plus an optional style — so measurement never sees ANSI codes. With
 * `NO_COLOR` set (or color disabled) every style degrades to bare text while
 * layouts stay identical.
 */
import { wrapToWidth } from './text.ts'

export type Color =
  | 'default'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'bright-black'
  | 'bright-red'
  | 'bright-green'
  | 'bright-yellow'
  | 'bright-blue'
  | 'bright-magenta'
  | 'bright-cyan'
  | 'bright-white'

export interface Style {
  fg?: Color
  bg?: Color
  bold?: boolean
  dim?: boolean
  reverse?: boolean
  /** 256-color foreground, reserved for the brand banner gradient (SPEC 0010). */
  fg256?: number
}

/** One run of styled text; the unit screens compose rows from. */
export interface Seg {
  text: string
  style?: Style
}

/** A rendered row = ordered segs; empty row = blank line. */
export type Row = Seg[]

const COLOR_CODES: Record<Color, [number, number]> = {
  default: [39, 49],
  black: [30, 40],
  red: [31, 41],
  green: [32, 42],
  yellow: [33, 43],
  blue: [34, 44],
  magenta: [35, 45],
  cyan: [36, 46],
  white: [37, 47],
  'bright-black': [90, 100],
  'bright-red': [91, 101],
  'bright-green': [92, 102],
  'bright-yellow': [93, 103],
  'bright-blue': [94, 104],
  'bright-magenta': [95, 105],
  'bright-cyan': [96, 106],
  'bright-white': [97, 107],
}

/** Semantic palette: screens reference roles, not raw colors. */
export const theme = {
  accent: { fg: 'bright-cyan' } satisfies Style,
  accentBg: { bg: 'cyan', fg: 'black', bold: true } satisfies Style,
  ok: { fg: 'bright-green' } satisfies Style,
  okBg: { bg: 'green', fg: 'black', bold: true } satisfies Style,
  warn: { fg: 'bright-yellow' } satisfies Style,
  danger: { fg: 'bright-red' } satisfies Style,
  dangerBg: { bg: 'red', fg: 'black', bold: true } satisfies Style,
  muted: { fg: 'bright-black' } satisfies Style,
  bold: { bold: true } satisfies Style,
  selected: { reverse: true } satisfies Style,
  title: { fg: 'bright-white', bold: true } satisfies Style,
  border: { fg: 'bright-black' } satisfies Style,
  borderDanger: { fg: 'red' } satisfies Style,
  borderAccent: { fg: 'cyan' } satisfies Style,
} as const

/** SGR escape for a style (empty string when nothing applies). */
export function sgrOf(style: Style | undefined, colorEnabled: boolean): string {
  if (!style || !colorEnabled) return ''
  const parts: string[] = []
  if (style.bold) parts.push('1')
  if (style.dim) parts.push('2')
  if (style.reverse) parts.push('7')
  if (style.fg256 !== undefined) parts.push(`38;5;${style.fg256}`)
  if (style.fg && style.fg !== 'default') parts.push(String(COLOR_CODES[style.fg][0]))
  if (style.bg && style.bg !== 'default') parts.push(String(COLOR_CODES[style.bg][1]))
  return parts.length ? `\x1b[${parts.join(';')}m` : ''
}

/** Render a row to a terminal string (reset at end; no trailing newline). */
export function rowToString(row: Row, colorEnabled: boolean): string {
  let out = ''
  for (const seg of row) {
    const sgr = sgrOf(seg.style, colorEnabled)
    if (sgr) out += `${sgr}${seg.text}\x1b[0m`
    else out += seg.text
  }
  return out
}

/** Plain text of a row (measurement / assertions). */
export function rowText(row: Row): string {
  return row.map((seg) => seg.text).join('')
}

// -- tiny construction helpers used everywhere downstream --

export const seg = (text: string, style?: Style): Seg => ({ text, style })

export function segs(items: readonly (readonly [string, Style | undefined])[]): Row {
  return items.map(([text, style]) => ({ text, style }))
}

/** Render plain lines into rows, hard-wrapping each to `width` columns. */
export function plainLines(lines: readonly string[], width: number): Row[] {
  const rows: Row[] = []
  for (const line of lines) {
    for (const part of wrapToWidth(line, width)) rows.push([{ text: part } as Seg])
  }
  return rows
}
