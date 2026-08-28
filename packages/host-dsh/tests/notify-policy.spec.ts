import { describe, expect, it } from 'vitest'
import { createContextNotice, createPageNoticeEvents, notifyRoute } from '../src/notify-policy.ts'
import { pageNoticeText, sourceTag as sourceLabel } from '@auto-guard/core'
import type { Decision } from '@auto-guard/core'

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'allow', source: 'llm', risk: 'low', reason: 'approved', ...overrides }
}

const config = {
  notifyAllow: 'page' as const,
  notifyDeny: 'context' as const,
  notifyAsk: 'context' as const,
}

describe('notify-policy: route', () => {
  it('maps allow/deny/ask to the matching config value', () => {
    expect(notifyRoute({ ...decision(), kind: 'allow' }, config)).toBe('page')
    expect(notifyRoute({ ...decision(), kind: 'deny' }, config)).toBe('context')
    expect(notifyRoute({ ...decision(), kind: 'ask' }, config)).toBe('context')
  })

  it('honours off', () => {
    expect(notifyRoute({ ...decision(), kind: 'allow' }, { ...config, notifyAllow: 'off' })).toBe('off')
  })
})

describe('notify-policy: page text and events', () => {
  it('builds a single-line page text with risk, source and no-context marker', () => {
    const text = pageNoticeText(decision({ source: 'session-cache', risk: 'low' }))
    expect(text).toBe('Auto Guard · 放行 · risk: low · 来源: 会话缓存 · 未进入上下文')
  })

  it('omits risk when absent', () => {
    const text = pageNoticeText(decision({ risk: undefined }))
    expect(text).not.toContain('risk:')
  })

  it('maps notified sources to Chinese labels and falls back for others', () => {
    expect(sourceLabel('session-cache')).toBe('会话缓存')
    expect(sourceLabel('llm')).toBe('LLM')
    expect(sourceLabel('static-allow')).toBe('白名单')
    expect(sourceLabel('history')).toBe('历史')
    expect(sourceLabel('learned')).toBe('学习规则')
    expect(sourceLabel('unknown' as Decision['source'])).toBe('其他')
  })

  it('creates log-only command/run + command/done payloads', () => {
    const events = createPageNoticeEvents(decision({ source: 'llm', risk: 'medium' }), 'cmd-1')
    expect(events.run).toMatchObject({
      commandId: 'cmd-1',
      name: 'auto-guard',
      source: { kind: 'user' },
    })
    expect(events.done).toEqual({
      commandId: 'cmd-1',
      kind: 'success',
      text: 'Auto Guard · 放行 · risk: medium · 来源: LLM · 未进入上下文',
    })
    expect('surfaceOp' in events.run).toBe(false)
    expect('surfaceOp' in events.done).toBe(false)
  })
})

describe('notify-policy: context notice', () => {
  it('builds a user-role notice message with the decision text', () => {
    const message = createContextNotice(decision({ kind: 'deny', source: 'hard-deny', reason: 'no', risk: undefined }))
    expect(message.role).toBe('user')
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'dsh-auto-guard', form: 'notice' })
    expect(message.content[0]).toMatchObject({ type: 'text', text: '⛔ 拦截 [黑名单]: no' })
  })

  it('keeps the existing fallback text when reason is absent', () => {
    const message = createContextNotice(decision({ kind: 'ask', source: 'llm', reason: undefined, risk: undefined }))
    expect(message.content[0]).toMatchObject({ type: 'text', text: '❓ 询问 [LLM]: 由 DSH Auto Guard 决定' })
  })
})
