import { describe, expect, it } from 'vitest'
import { decisionReasonText, parseVerdict, serializeVerdict, statusToOutputStatus, statusToReply } from '../src/hook-output.ts'
import type { Decision } from '@auto-guard/core'

describe('serializeVerdict / parseVerdict', () => {
  it('always emits one JSON object, including allow (unlike the silent claude/zcode hooks)', () => {
    expect(JSON.parse(serializeVerdict({ status: 'allow' }))).toEqual({ status: 'allow' })
  })

  it('round-trips deny with a reason', () => {
    const verdict = parseVerdict(serializeVerdict({ status: 'deny', reason: '命中黑名单' }))
    expect(verdict).toEqual({ status: 'deny', reason: '命中黑名单' })
  })

  it('rejects non-JSON and non-verdict stdout (plugin treats as ask)', () => {
    expect(parseVerdict('not json')).toBeUndefined()
    expect(parseVerdict('{"status":"weird"}')).toBeUndefined()
    expect(parseVerdict('{"reason":"no status"}')).toBeUndefined()
    expect(parseVerdict('')).toBeUndefined()
  })
})

describe('statusToReply (ADR-0011 revision mapping)', () => {
  it('allow → once, deny → reject, ask → no reply (native TUI)', () => {
    expect(statusToReply('allow')).toBe('once')
    expect(statusToReply('deny')).toBe('reject')
    expect(statusToReply('ask')).toBeUndefined()
  })
})

describe('statusToOutputStatus (permission.ask forward-compat mapping)', () => {
  it('allow/deny set output.status; ask leaves it untouched', () => {
    expect(statusToOutputStatus('allow')).toBe('allow')
    expect(statusToOutputStatus('deny')).toBe('deny')
    expect(statusToOutputStatus('ask')).toBeUndefined()
  })
})

describe('decisionReasonText', () => {
  it('keeps the layer tag from notification text', () => {
    const decision: Decision = { kind: 'deny', source: 'hard-deny', reason: 'risky', risk: 'high' }
    expect(decisionReasonText(decision)).toContain('risky')
  })
})
