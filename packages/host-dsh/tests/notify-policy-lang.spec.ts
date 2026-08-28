/**
 * DSH notification English golden paths (ticket 03): context-route notices
 * and page-notice events render English labels and layer tags when the
 * effective language is injected, while the zh default stays byte-stable.
 */
import { describe, expect, it } from 'vitest'
import { createContextNotice, createPageNoticeEvents, pageNotice } from '../src/notify-policy.ts'
import type { Decision } from '@auto-guard/core'

const allow: Decision = { kind: 'allow', source: 'static-allow', risk: 'low', reason: 'fine' }
const denyNoReason: Decision = { kind: 'deny', source: 'session-cache' }

describe('dsh notify-policy: language injection', () => {
  it('context notice renders English labels, tags and fallback reason', () => {
    expect(createContextNotice(allow, 'en').content[0]!.text).toBe('✅ allow [allowlist] (risk: low): fine')
    expect(createContextNotice(denyNoReason, 'en').content[0]!.text).toBe('⛔ deny [session cache]: decided by DSH Auto Guard')
  })

  it('page notice and page events switch to English', () => {
    expect(pageNotice(allow, 'en')).toBe('Auto Guard · allow · risk: low · source: allowlist · not sent to context')
    const events = createPageNoticeEvents(denyNoReason, 'cmd-1', 'en')
    expect(events.run.args).toBe('Auto Guard · deny · source: session cache · not sent to context')
    expect(events.done.text).toBe(events.run.args)
  })

  it('zh default stays byte-stable without a lang argument', () => {
    expect(createContextNotice(allow).content[0]!.text).toBe('✅ 放行 [白名单] (risk: low): fine')
    expect(pageNotice(denyNoReason)).toBe('Auto Guard · 拦截 · 来源: 会话缓存 · 未进入上下文')
  })
})
