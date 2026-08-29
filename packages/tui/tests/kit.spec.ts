import { describe, expect, it } from 'vitest'
import { normalizeKeypress, isChar } from '../src/keys.ts'
import {
  checkList,
  confirmDialog,
  footerBar,
  inputDisplay,
  inputKey,
  listBox,
  moveCursor,
  panel,
  rowText,
} from '../src/ui/kit.ts'
import { rowToString, seg, theme } from '../src/ui/theme.ts'
import { emptyInput } from '../src/ui/kit.ts'

describe('keypress normalization', () => {
  it('maps readline names and printable chars', () => {
    expect(normalizeKeypress('', { name: 'up' }).name).toBe('up')
    expect(normalizeKeypress('', { name: 'return' }).name).toBe('enter')
    const ch = normalizeKeypress('q', { name: 'q' })
    expect(ch).toMatchObject({ name: 'char', ch: 'q' })
    expect(isChar(ch, 'q')).toBe(true)
    expect(normalizeKeypress(' ', { name: 'space' }).name).toBe('space')
  })
})

describe('kit components', () => {
  it('panel renders exact height with borders and title', () => {
    const rows = panel(20, [{ text: 'hello' }, { text: '中文' }], { title: 'T', height: 3 })
    expect(rows).toHaveLength(5)
    expect(rowText(rows[0]!)).toBe('┌─ T ' + '─'.repeat(14) + '┐')
    expect(rowText(rows[1]!)).toBe('│hello             │')
    expect(rowText(rows[4]!)).toBe('└──────────────────┘')
  })

  it('listBox marks the cursor row and hints', () => {
    const rows = listBox(24, [{ text: 'alpha', hint: 'on' }, { text: 'beta' }], 0)
    expect(rowText(rows[0]!).startsWith('❯ alpha')).toBe(true)
    expect(rowText(rows[1]!).startsWith('  beta')).toBe(true)
  })

  it('moveCursor wraps around', () => {
    expect(moveCursor(0, -1, 3)).toBe(2)
    expect(moveCursor(2, 1, 3)).toBe(0)
  })

  it('checkList renders checkbox states', () => {
    const rows = checkList(30, [{ text: 'zcode', checked: true }, { text: 'dsh', checked: false, locked: true }], 0)
    expect(rowText(rows[0]!)).toContain('[x]')
    expect(rowText(rows[1]!)).toContain('[ ]')
  })

  it('confirmDialog keeps frame height and carries both buttons', () => {
    const base = Array.from({ length: 10 }, () => [seg('x')])
    const rows = confirmDialog(base, 40, {
      message: ['确定？'],
      danger: true,
      confirmFocused: false,
      yesLabel: '确认',
      noLabel: '取消',
    })
    expect(rows).toHaveLength(10)
    expect(rows.some((r) => rowText(r).includes('确认') && rowText(r).includes('取消'))).toBe(true)
    expect(rows.some((r) => rowText(r).includes('确定？'))).toBe(true)
  })

  it('inline input edits with caret and masking', () => {
    let model = emptyInput()
    for (const ch of ['a', 'b', 'c']) model = inputKey(model, { name: 'char', ch })
    model = inputKey(model, { name: 'left' })
    model = inputKey(model, { name: 'char', ch: 'X' })
    expect(model.value).toBe('abXc')
    model = inputKey(model, { name: 'backspace' })
    expect(model.value).toBe('abc')
    const masked = { ...model, masked: true }
    expect(inputDisplay(masked, 20)).toBe('••▌•')
  })

  it('footer shows receipt with exit code', () => {
    const row = footerBar(60, 'hints', { code: 2, argv: 'guard ping' }, null, 0)
    expect(rowText(row)).toContain('✗')
    expect(rowText(row)).toContain('→ 2')
  })

  it('rowToString emits no escapes when color disabled', () => {
    const row = [seg('hi', theme.ok)]
    expect(rowToString(row, false)).toBe('hi')
    expect(rowToString(row, true)).toContain('\x1b[')
  })
})
