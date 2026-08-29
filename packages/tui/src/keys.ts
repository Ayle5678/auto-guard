/**
 * Key event normalization (ADR-0014): readline keypress events reduced to a
 * small union the reducer can switch on. Pure — the driver feeds it, tests
 * construct events directly.
 */
export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'delete'
  | 'tab'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'space'
  | 'char'
  | 'unknown'

export interface KeyEvent {
  name: KeyName
  /** Printable character for `char` (and `space`). */
  ch?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

/** Normalize a readline keypress (str + key) into a KeyEvent. */
export function normalizeKeypress(str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }): KeyEvent {
  const base = { ctrl: Boolean(key.ctrl), meta: Boolean(key.meta), shift: Boolean(key.shift) }
  switch (key.name) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
    case 'tab':
    case 'enter':
    case 'return':
    case 'escape':
    case 'backspace':
    case 'delete':
    case 'home':
    case 'end':
    case 'pageup':
    case 'pagedown':
      return { ...base, name: key.name === 'return' ? 'enter' : (key.name as KeyName) }
    case 'space':
      return { ...base, name: 'space', ch: ' ' }
    default:
      break
  }
  if (key.ctrl && key.name === 'c') return { ...base, name: 'char', ch: 'c' }
  // Printable single character (length in code points, not control bytes).
  if (str && !key.ctrl && !key.meta) {
    const ch = [...str][0]
    if (ch && ch >= ' ') return { ...base, name: 'char', ch }
  }
  return { ...base, name: 'unknown' }
}

/** Dispatch helper: `key(ev, 'q')` — printable-key match. */
export function isChar(ev: KeyEvent, ch: string): boolean {
  return ev.name === 'char' && ev.ch === ch && !ev.ctrl && !ev.meta
}
