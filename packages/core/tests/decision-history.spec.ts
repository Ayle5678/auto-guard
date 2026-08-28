import { describe, expect, it } from 'vitest'
import { appendDecisionHistory, formatLocalTime, readRecentDecisions, truncateOneLine, type RuntimeStatus } from '../src/decision-history.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('formatLocalTime', () => {
  it('renders a local 24h MM-DD HH:mm:ss from an ISO instant', () => {
    // Build the expectation from local components so the test is TZ-independent.
    const local = new Date(2026, 7, 28, 9, 5, 3)
    expect(formatLocalTime(local.toISOString())).toBe('08-28 09:05:03')
  })

  it('never shows a UTC-shifted clock time', () => {
    const local = new Date(2026, 0, 2, 23, 59, 59)
    const rendered = formatLocalTime(local.toISOString())
    expect(rendered.endsWith('23:59:59')).toBe(true)
  })

  it('falls back to the raw text for non-ISO input and empty values', () => {
    expect(formatLocalTime('not-a-date')).toBe('not-a-date')
    expect(formatLocalTime(undefined)).toBe('')
    expect(formatLocalTime('')).toBe('')
  })
})

describe('truncateOneLine', () => {
  it('keeps short single-line text unchanged', () => {
    expect(truncateOneLine('git status', 48)).toBe('git status')
  })

  it('flattens newlines and repeated whitespace into one line', () => {
    expect(truncateOneLine('echo a\n\n  b\tc', 48)).toBe('echo a b c')
  })

  it('caps length including the ellipsis', () => {
    const out = truncateOneLine('x'.repeat(100), 10)
    expect(out.length).toBe(10)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('decision history records the guarded command', () => {
  it('round-trips lastCommand through append/read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-history-'))
    try {
      const path = join(dir, 'history.jsonl')
      const entry: RuntimeStatus = {
        lastRunAt: new Date().toISOString(),
        lastTool: 'Bash',
        lastCommand: 'npm run build',
        lastDecisionKind: 'allow',
        lastDecisionSource: 'llm',
        lastDetail: 'Reviewed by LLM',
      }
      appendDecisionHistory(entry, path)
      const entries = readRecentDecisions(1, path)
      expect(entries[0]?.lastCommand).toBe('npm run build')
      expect(entries[0]?.lastDetail).toBe('Reviewed by LLM')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
