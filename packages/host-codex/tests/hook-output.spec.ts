/**
 * Codex exit-wire protocol: the default hookSpecificOutput dialect with the
 * SPEC 0015 capability-driven ask→deny translation (codex parses "ask" but
 * discards it and continues the call — fail-open — so asks must never ride
 * the wire).
 */
import { describe, expect, it } from 'vitest'
import { decisionReasonText, codexWire, serializeHookOutput, withDeletionHint } from '../src/hook-output.ts'
import type { Decision } from '@auto-guard/core'

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'deny', source: 'llm', reason: '危险命令', ...overrides }
}

describe('serializeHookOutcome (plain protocol)', () => {
  it('emits nothing for allow (silence continues the normal approval flow)', () => {
    expect(serializeHookOutput({ action: 'allow' })).toBe('')
  })

  it('renders deny as hookSpecificOutput JSON codex accepts', () => {
    const parsed = JSON.parse(serializeHookOutput({ action: 'deny', reason: '命中黑名单: rm -rf /' })) as {
      hookSpecificOutput: Record<string, string>
    }
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput'])
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('黑名单')
  })
})

describe('codexWire (deny-fallback translation)', () => {
  it('never emits permissionDecision "ask" — deny with a note instead', () => {
    for (const lang of ['zh', 'en'] as const) {
      const parsed = JSON.parse(codexWire.serialize({ action: 'ask', reason: '需要人工确认' }, lang)) as {
        hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
      }
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('需要人工确认')
      expect(parsed.hookSpecificOutput.permissionDecisionReason).not.toContain('"ask"')
    }
  })

  it('notes the no-prompt fallback in the configured language', () => {
    const zh = JSON.parse(codexWire.serialize({ action: 'ask', reason: 'x' }, 'zh')) as { hookSpecificOutput: { permissionDecisionReason: string } }
    expect(zh.hookSpecificOutput.permissionDecisionReason).toContain('已按拒绝处理')
    const en = JSON.parse(codexWire.serialize({ action: 'ask', reason: 'x' }, 'en')) as { hookSpecificOutput: { permissionDecisionReason: string } }
    expect(en.hookSpecificOutput.permissionDecisionReason).toContain('denied the call')
  })

  it('lets allow stay silent and deny pass through untouched', () => {
    expect(codexWire.serialize({ action: 'allow' })).toBe('')
    const deny = JSON.parse(codexWire.serialize({ action: 'deny', reason: 'nope' })) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(deny.hookSpecificOutput.permissionDecisionReason).toBe('nope')
  })
})

describe('decisionReasonText', () => {
  it('keeps the layer tag and risk from notification text', () => {
    const text = decisionReasonText(decision({ risk: 'high' }))
    expect(text).toContain('[LLM]')
    expect(text).toContain('拦截')
    expect(text).toContain('risk: high')
  })
})

describe('withDeletionHint', () => {
  it('appends the retry-with-reason protocol hint', () => {
    const hinted = withDeletionHint('递归删除需复核')
    expect(hinted).toContain('[删除理由]')
  })
})
