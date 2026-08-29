import { describe, expect, it } from 'vitest'
import { Terminal, assertInteractive, type KeyStream, type OutStream } from '../src/term.ts'

function streams(): { keys: KeyStream; out: OutStream; written: string[] } {
  const written: string[] = []
  const keys: KeyStream = {
    isTTY: true,
    setRawMode: () => {},
    on: () => {},
    off: () => {},
  }
  const out: OutStream = { columns: 40, rows: 5, write: (t) => written.push(t) }
  return { keys, out, written }
}

describe('assertInteractive', () => {
  it('refuses non-TTY and dumb terminals', () => {
    expect(assertInteractive({ isTTY: false }, {})).toBe('notATty')
    expect(assertInteractive({ isTTY: true }, { TERM: 'dumb' })).toBe('dumbTerm')
    expect(assertInteractive({ isTTY: true }, { TERM: 'xterm' })).toBeNull()
  })
})

describe('Terminal paint diffing', () => {
  it('repaints only changed rows; identical frames write nothing', () => {
    const { keys, out, written } = streams()
    const term = new Terminal(keys, out)
    const frame = [[{ text: 'aaa' }], [{ text: 'bbb' }]]
    const first = term.paint(frame)
    expect(first).toContain('\x1b[2Kaaa')
    expect(written).toHaveLength(1)
    // Same frame again: zero writes.
    expect(term.paint(frame)).toBe('')
    // One row changes: only that row is rewritten.
    const delta = term.paint([[{ text: 'aaa' }], [{ text: 'XXX' }]])
    expect(delta).toContain('XXX')
    expect(delta).not.toContain('aaa')
    // Frame height change forces a full clear + repaint.
    written.length = 0
    const full = term.paint([[{ text: 'one' }]])
    expect(full).toContain('\x1b[2J')
  })

  it('restore is idempotent and leaves alt screen + cursor visible', () => {
    const { keys, out, written } = streams()
    const term = new Terminal(keys, out)
    term.enter()
    term.restore()
    term.restore()
    const restores = written.filter((chunk) => chunk.includes('\x1b[?1049l') && chunk.includes('\x1b[?25h'))
    expect(restores).toHaveLength(1)
  })
})
