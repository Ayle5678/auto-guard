/**
 * Shared guard-surface catalog snapshot (ADR-0023). The key set is pinned so
 * a new guard-surface key is a conscious snapshot update — wording drift
 * across hosts starts with an unreviewed key here. Host catalogs must not
 * re-define any of these keys (the per-host anti-drift checks land with the
 * ticket-02 migration).
 */
import { describe, expect, it } from 'vitest'
import { guardMessage, guardMessageKeys, isGuardMessageKey } from '../src/guard-messages.ts'
import type { Lang } from '../src/lang.ts'

/** The canonical guard-surface key set, sorted. Update deliberately. */
const CANONICAL_KEYS: readonly string[] = []

describe('shared guard-surface catalog (ADR-0023)', () => {
  it('key set matches the pinned canonical list', () => {
    expect([...guardMessageKeys].sort()).toEqual([...CANONICAL_KEYS].sort())
  })

  it('every key renders a non-empty string in both languages', () => {
    for (const key of guardMessageKeys) {
      for (const lang of ['zh', 'en'] as const satisfies readonly Lang[]) {
        const text = guardMessage(lang, key)
        expect(text, `${key}[${lang}]`).toBeTruthy()
        expect(typeof text).toBe('string')
      }
    }
  })

  it('isGuardMessageKey accepts only catalog keys', () => {
    for (const key of guardMessageKeys) expect(isGuardMessageKey(key)).toBe(true)
    expect(isGuardMessageKey('definitelyNotAKey')).toBe(false)
  })
})
