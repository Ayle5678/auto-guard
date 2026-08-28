import { describe, expect, it } from 'vitest'
import { notificationText, notifyRoute } from '../src/notify.ts'
import type { Decision, GuardConfig } from '../src/types.ts'

describe('notify: text', () => {
  it('builds allow/deny/ask texts with reason', () => {
    expect(notificationText({ kind: 'allow', source: 'static-allow', reason: 'safe' } as Decision)).toContain('放行')
    expect(notificationText({ kind: 'deny', source: 'hard-deny', reason: 'no' } as Decision)).toContain('拦截')
    expect(notificationText({ kind: 'ask', source: 'sensitive-path', reason: 'confirm?' } as Decision)).toContain('询问')
  })

  it('includes risk when present and never includes script content', () => {
    const text = notificationText({ kind: 'allow', source: 'llm', risk: 'medium', reason: 'ok' } as Decision)
    expect(text).toContain('risk: medium')
    expect(text).toContain('ok')
  })

  it('reports cache hits and directory deletes using the same kind-based label', () => {
    const cached = notificationText({ kind: 'allow', source: 'session-cache', reason: 'reused', cached: true } as Decision)
    expect(cached).toContain('放行')
    expect(cached).toContain('reused')
    const del = notificationText({ kind: 'deny', source: 'directory-delete', reason: 'x' } as Decision)
    expect(del).toContain('拦截')
  })

  it('labels history and learned sources', () => {
    expect(notificationText({ kind: 'allow', source: 'history', reason: 'hist' } as Decision)).toContain('[历史]')
    expect(notificationText({ kind: 'allow', source: 'learned', reason: 'learn' } as Decision)).toContain('[学习规则]')
  })
})

describe('notify: routing', () => {
  const cfg: Pick<GuardConfig, 'notifyAllow' | 'notifyDeny' | 'notifyAsk'> = {
    notifyAllow: 'page',
    notifyDeny: 'context',
    notifyAsk: 'context',
  }
  const allow = { kind: 'allow', source: 'session-cache' } as Decision
  const deny = { kind: 'deny', source: 'hard-deny' } as Decision
  const ask = { kind: 'ask', source: 'sensitive-path' } as Decision

  it('routes each kind by its own config key with the default policy', () => {
    expect(notifyRoute(allow, cfg)).toBe('page')
    expect(notifyRoute(deny, cfg)).toBe('context')
    expect(notifyRoute(ask, cfg)).toBe('context')
  })

  it('honours per-kind overrides', () => {
    expect(notifyRoute(allow, { ...cfg, notifyAllow: 'off' })).toBe('off')
    expect(notifyRoute(deny, { ...cfg, notifyDeny: 'off' })).toBe('off')
    expect(notifyRoute(ask, { ...cfg, notifyAsk: 'page' })).toBe('page')
    expect(notifyRoute(allow, { ...cfg, notifyAllow: 'context' })).toBe('context')
  })
})
