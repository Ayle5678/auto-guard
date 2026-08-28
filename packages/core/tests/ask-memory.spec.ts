import { describe, expect, it } from 'vitest'
import { canRememberAsk, resolveAskMemory } from '../src/ask-memory.ts'
import type { Decision } from '../src/types.ts'

function ask(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'ask', source: 'llm', risk: 'medium', reason: 'uncertain', ...overrides }
}

describe('ask-memory: canRememberAsk', () => {
  it('enables four-state memory for plain LLM asks', () => {
    expect(canRememberAsk(ask())).toBe(true)
  })

  it('disables memory for file-tracker, sensitive-path, and directory-delete asks', () => {
    expect(canRememberAsk(ask({ source: 'file-tracker' }))).toBe(false)
    expect(canRememberAsk(ask({ source: 'sensitive-path' }))).toBe(false)
    expect(canRememberAsk(ask({ source: 'directory-delete' }))).toBe(false)
  })

  it('disables memory for reviewer failures and high-risk asks', () => {
    expect(canRememberAsk(ask({ reviewerFailed: true }))).toBe(false)
    expect(canRememberAsk(ask({ risk: 'high' }))).toBe(false)
  })
})

describe('ask-memory: resolveAskMemory', () => {
  it('maps allow-once to a one-time allow without a cache write', () => {
    expect(resolveAskMemory('同意（仅本次）')).toEqual({ action: 'allow' })
  })

  it('maps allow-session to an allow with a session allow write', () => {
    expect(resolveAskMemory('本会话都同意')).toEqual({ action: 'allow', cacheWrite: { kind: 'allow' } })
  })

  it('maps deny-once to a block without a cache write', () => {
    expect(resolveAskMemory('拒绝（可输原因）', '不要')).toEqual({ action: 'block', reason: '不要' })
  })

  it('maps deny-session to a block with a session deny write and reason', () => {
    expect(resolveAskMemory('本会话都拒绝（可输原因）', '不要')).toEqual({
      action: 'block',
      cacheWrite: { kind: 'deny', reason: '不要' },
      reason: '不要',
    })
  })

  it('fails closed when no choice is made', () => {
    expect(resolveAskMemory(undefined)).toEqual({ action: 'block' })
  })
})
