/**
 * CJK-aware display-width text ops — the foundation of bilingual alignment
 * (SPEC 0009 / ADR-0014). All measurements count terminal columns: CJK,
 * fullwidth forms and common emoji occupy 2, combining marks 0, the rest 1.
 */

/** Column width of one code point (zero for combining marks, 2 for wide). */
export function charWidth(code: number): number {
  if (code === 0) return 0
  // Combining marks and zero-width characters.
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    code === 0x200b ||
    code === 0x200d ||
    code === 0xfe0f ||
    code === 0xfe0e
  ) {
    return 0
  }
  // Wide ranges: Hangul Jamo, CJK blocks, Kana, fullwidth forms, emoji.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x16fe0 && code <= 0x16fe4) ||
    (code >= 0x17000 && code <= 0x18aff) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** Total display width of a string (iterating code points, not UTF-16 units). */
export function textWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

/** Truncate to `max` display columns, appending an ellipsis when cut. */
export function truncateToWidth(text: string, max: number, ellipsis = '…'): string {
  if (textWidth(text) <= max) return text
  const limit = Math.max(0, max - textWidth(ellipsis))
  let width = 0
  let out = ''
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (width + w > limit) break
    out += ch
    width += w
  }
  return out + ellipsis
}

/** Pad with spaces to an exact display width (left or right aligned). */
export function padToWidth(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = width - textWidth(text)
  if (gap <= 0) return text
  return align === 'left' ? text + ' '.repeat(gap) : ' '.repeat(gap) + text
}

/** Cut or pad to exactly `width` display columns. */
export function fitToWidth(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = truncateToWidth(text, width, '')
  return padToWidth(truncated, width, align)
}

/** Split a plain string into chunks of at most `max` display columns. */
export function wrapToWidth(text: string, max: number): string[] {
  if (max <= 0) return [text]
  const lines: string[] = []
  let current = ''
  let width = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (width + w > max && current !== '') {
      lines.push(current)
      current = ch
      width = w
    } else {
      current += ch
      width += w
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current)
  return lines
}
