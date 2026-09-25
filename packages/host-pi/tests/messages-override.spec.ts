/**
 * Pi guard-surface override channel (ADR-0023 ticket 03): wording differences
 * ride the data slot (the ADR-0016 channel, extended to pi) — never re-defined
 * keys. The default lookup must stay byte-identical to the shared catalog.
 */
import { describe, expect, it } from 'vitest'
import { guardMessage } from '@auto-guard/core'
import { createPiMessage, piMessage } from '../src/messages.ts'

const OVERRIDES = {
  deleteFailLlmTitle: { en: 'Pi flavor: the LLM vetoed this deletion' },
}

describe('pi guard-surface override channel (ADR-0023)', () => {
  it('default lookup resolves guard keys from the shared catalog', () => {
    expect(piMessage('zh', 'pingOk')).toBe(guardMessage('zh', 'pingOk'))
    expect(piMessage('en', 'deleteFailLlmTitle')).toBe(guardMessage('en', 'deleteFailLlmTitle'))
  })

  it('overridden guard keys render the override; other languages fall through', () => {
    const t = createPiMessage(OVERRIDES)
    expect(t('en', 'deleteFailLlmTitle')).toBe('Pi flavor: the LLM vetoed this deletion')
    expect(t('zh', 'deleteFailLlmTitle')).toBe(guardMessage('zh', 'deleteFailLlmTitle'))
  })

  it('non-overridden guard keys and pi chrome keys are untouched', () => {
    const t = createPiMessage(OVERRIDES)
    expect(t('en', 'pingOk')).toBe(guardMessage('en', 'pingOk'))
    expect(t('zh', 'pingFail', { error: 'x' })).toBe(piMessage('zh', 'pingFail', { error: 'x' }))
    expect(t('zh', 'askTitle')).toBe(piMessage('zh', 'askTitle'))
  })
})
