/**
 * Shared guard-surface catalog snapshot (ADR-0023). The key set is pinned so
 * a new guard-surface key is a deliberate snapshot update — cross-host
 * wording drift starts with an unreviewed key here. The per-host anti-drift
 * checks (host catalogs must not re-define these keys) live beside each host
 * catalog.
 */
import { describe, expect, it } from 'vitest'
import { guardMessage, guardMessageKeys, isGuardMessageKey } from '../src/guard-messages.ts'
import type { Lang } from '../src/lang.ts'

/** The canonical guard-surface key set, sorted. Update deliberately. */
const CANONICAL_KEYS: readonly string[] = [
  'askInvalidIndex',
  'askListEmpty',
  'askListHeader',
  'askResolvedAllow',
  'askResolvedDeny',
  'askResolvedDenyWithReason',
  'askRow',
  'askStaleIndex',
  'clearFallbackKeyDone',
  'clearKeyDone',
  'createDone',
  'createFailed',
  'createNeedsPassword',
  'createUnsupported',
  'deleteAskReason',
  'deleteFailDefaultReason',
  'deleteFailLlmTitle',
  'deleteFailReviewerTitle',
  'deleteNoDetail',
  'deleteRunAnyway',
  'deletionRetryHint',
  'examineClearedAll',
  'examineClearedOld',
  'examineOff',
  'examineOn',
  'exportDone',
  'exportFailed',
  'exportUnsupported',
  'optimizeAutoUnsupported',
  'pingFail',
  'pingNoDirectEndpoint',
  'pingOk',
  'reloadNote',
  'setFallbackKeyInvalid',
  'setFallbackKeyNeedsTty',
  'setFallbackKeyPrompt',
  'setFallbackKeySaved',
  'setKeyEnvWarning',
  'setKeyNeedsTty',
  'setLangDone',
  'setLangInvalid',
  'showFallbackKeyEnvSet',
  'showFallbackKeyEnvUnset',
  'showFallbackKeyNoStore',
  'showFallbackKeyStored',
  'showKeyEnvSet',
  'showKeyEnvUnset',
  'showKeyLegacy',
  'showKeyNoLegacy',
  'showKeyNoStore',
  'showKeyStored',
  'statsAuditCount',
  'statsExamineOff',
  'unknownError',
]

describe('shared guard-surface catalog (ADR-0023)', () => {
  it('key set matches the pinned canonical list', () => {
    expect([...guardMessageKeys].sort()).toEqual([...CANONICAL_KEYS].sort())
  })

  it('every key renders a non-empty string in both languages', () => {
    for (const key of guardMessageKeys) {
      for (const lang of ['zh', 'en'] as const satisfies readonly Lang[]) {
        expect(guardMessage(lang, key), `${key}[${lang}]`).toBeTruthy()
      }
    }
  })

  it('isGuardMessageKey accepts only catalog keys', () => {
    for (const key of guardMessageKeys) expect(isGuardMessageKey(key)).toBe(true)
    expect(isGuardMessageKey('definitelyNotAKey')).toBe(false)
  })
})
