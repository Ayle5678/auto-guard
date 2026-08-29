import { describe, expect, it } from 'vitest'
import { decisionReasonText, serializeHookOutput, withDeletionHint } from '../src/hook-output.ts'
import type { Decision } from '@auto-guard/core'

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'deny', source: 'llm', reason: '危险命令', ...overrides }
}

describe('serializeHookOutput', () => {
  it('emits nothing for allow (silence is pass; normal permission flow applies)', () => {
    expect(serializeHookOutput({ action: 'allow' })).toBe('')
  })

  it('produces the strict PreToolUse schema for ask', () => {
    const parsed = JSON.parse(serializeHookOutput({ action: 'ask', reason: '需要确认' })) as {
      hookSpecificOutput: Record<string, string>
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('需要确认')
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput'])
  })

  it('carves deny reasons into permissionDecisionReason', () => {
    const parsed = JSON.parse(serializeHookOutput({ action: 'deny', reason: '命中黑名单 [黑名单]: rm -rf /' })) as never as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('黑名单')
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
    expect(withDeletionHint('递归删除需复核')).toContain('[删除理由]')
  })
})
