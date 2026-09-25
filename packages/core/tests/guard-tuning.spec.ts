/**
 * SPEC 0019 ticket 04: GuardTuning is the engine-tuning slice of GuardConfig,
 * cut at the composition root. The slice's default shape is pinned here: a
 * new GuardConfig key must NOT appear in the slice (and therefore must not
 * touch the engine interface) without an explicit slice change.
 */
import { describe, expect, it } from 'vitest'
import { defaultGuardConfig, tuningOf } from '../src/config.ts'
import type { GuardTuning } from '../src/types.ts'

describe('GuardTuning slice (ADR-0021)', () => {
  it('slices exactly the ten engine keys from the default config', () => {
    const tuning = tuningOf(defaultGuardConfig('/tmp/ag-tuning'))
    expect(tuning).toEqual({
      lang: undefined,
      lowRiskTtlDays: 30,
      mediumRiskTtlDays: 7,
      alwaysReviewCacheTtlMinutes: 30,
      onTimeout: 'deny',
      fileTrackerDefault: 'ask',
      historyEnabled: false,
      examineEnabled: false,
      historyMinTotal: 4,
      historyMinLlm: 1,
    } satisfies GuardTuning)
  })

  it('carries the host-resolved language and overrides through', () => {
    const config = defaultGuardConfig('/tmp/ag-tuning')
    config.lang = 'en'
    config.historyMinTotal = 9
    expect(tuningOf(config)).toMatchObject({ lang: 'en', historyMinTotal: 9 })
  })
})
