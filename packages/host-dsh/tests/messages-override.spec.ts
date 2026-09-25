/**
 * DSH guard-surface override channel (ADR-0023 ticket 03): wording differences
 * ride the data slot (the ADR-0016 channel, extended to dsh) — never re-defined
 * keys. The default lookup must stay byte-identical to the shared catalog.
 */
import { describe, expect, it } from 'vitest'
import { guardMessage } from '@auto-guard/core'
import { createDshMessage, dshMessage } from '../src/messages.ts'

const OVERRIDES = {
  pingNoDirectEndpoint: { zh: 'DSH 味：未配置直连审查端点' },
}

describe('dsh guard-surface override channel (ADR-0023)', () => {
  it('default lookup resolves guard keys from the shared catalog', () => {
    expect(dshMessage('zh', 'pingNoDirectEndpoint')).toBe(guardMessage('zh', 'pingNoDirectEndpoint'))
    expect(dshMessage('en', 'deleteFailDefaultReason')).toBe(guardMessage('en', 'deleteFailDefaultReason'))
  })

  it('overridden guard keys render the override; other languages fall through', () => {
    const t = createDshMessage(OVERRIDES)
    expect(t('zh', 'pingNoDirectEndpoint')).toBe('DSH 味：未配置直连审查端点')
    expect(t('en', 'pingNoDirectEndpoint')).toBe(guardMessage('en', 'pingNoDirectEndpoint'))
  })

  it('non-overridden guard keys and dsh chrome keys are untouched', () => {
    const t = createDshMessage(OVERRIDES)
    expect(t('zh', 'exportDone')).toBe(guardMessage('zh', 'exportDone'))
    expect(t('zh', 'analyzeDone', { count: 3 })).toBe(dshMessage('zh', 'analyzeDone', { count: 3 }))
    expect(t('zh', 'contextFallbackReason')).toBe(dshMessage('zh', 'contextFallbackReason'))
  })
})
