import { describe, expect, it } from 'vitest'
import { charWidth, padToWidth, textWidth, truncateToWidth, wrapToWidth } from '../src/ui/text.ts'

describe('CJK-aware text ops', () => {
  it('measures CJK and emoji as double width', () => {
    expect(textWidth('中文abc')).toBe(7)
    expect(textWidth('🛡️')).toBe(2) // variation selector adds 0
    expect(textWidth('')).toBe(0)
    expect(charWidth('a'.codePointAt(0)!)).toBe(1)
  })

  it('truncates to display columns with ellipsis', () => {
    expect(truncateToWidth('中abcdefgh', 5)).toBe('中ab…')
    expect(truncateToWidth('abc', 5)).toBe('abc')
    expect(truncateToWidth('中文abc', 4, '')).toBe('中文')
  })

  it('pads to exact display width both alignments', () => {
    expect(textWidth(padToWidth('中文', 8))).toBe(8)
    expect(padToWidth('中文', 8, 'right')).toBe('    中文')
  })

  it('wraps long mixed-script lines at column boundaries', () => {
    const lines = wrapToWidth('中文中文中文abcdefg', 8)
    expect(lines).toEqual(['中文中文', '中文abcd', 'efg'])
  })
})
