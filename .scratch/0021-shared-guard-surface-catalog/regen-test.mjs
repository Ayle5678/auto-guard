// SPEC 0021 ticket 02 — regenerate packages/core/tests/guard-messages.spec.ts
// with the canonical key pin injected programmatically (no transcription).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const keys = readFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-keys.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .sort()

const file = `/**
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
${keys.map((k) => `  '${k}',`).join('\n')}
]

describe('shared guard-surface catalog (ADR-0023)', () => {
  it('key set matches the pinned canonical list', () => {
    expect([...guardMessageKeys].sort()).toEqual([...CANONICAL_KEYS].sort())
  })

  it('every key renders a non-empty string in both languages', () => {
    for (const key of guardMessageKeys) {
      for (const lang of ['zh', 'en'] as const satisfies readonly Lang[]) {
        expect(guardMessage(lang, key), \`\${key}[\${lang}]\`).toBeTruthy()
      }
    }
  })

  it('isGuardMessageKey accepts only catalog keys', () => {
    for (const key of guardMessageKeys) expect(isGuardMessageKey(key)).toBe(true)
    expect(isGuardMessageKey('definitelyNotAKey')).toBe(false)
  })
})
`

writeFileSync(join(root, 'packages/core/tests/guard-messages.spec.ts'), file)
console.log(`test regenerated with ${keys.length} pinned keys`)
