/**
 * Catalog boundary discipline (ADR-0023): guard-surface keys live ONLY in the
 * core shared catalog; the four host catalogs keep host chrome (dialogs,
 * settings pages, installer, TUI). A host that re-defines a guard-surface key
 * re-opens the wording-drift wound this catalog exists to close, so the
 * boundary is enforced here as a hard check.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { guardMessageKeys } from '@auto-guard/core'

const here = dirname(fileURLToPath(import.meta.url))

/** Host-side message catalogs (ADR-0016 runtime, pi, dsh, cli shell). */
const HOST_CATALOGS = [
  '../../host-runtime/src/messages.ts',
  '../../host-pi/src/messages.ts',
  '../../host-dsh/src/messages.ts',
  '../../cli/src/shell-messages.ts',
]

/** Key names of one catalog's two language blocks, read from source. */
function catalogKeys(rel: string): string[] {
  const src = readFileSync(join(here, rel), 'utf8')
  const start = src.indexOf('defineCatalog(')
  if (start < 0) throw new Error(`${rel}: defineCatalog not found`)
  const body = src.slice(start, src.indexOf(')\n', start))
  return [...body.matchAll(/^ {4}([A-Za-z_]\w*): /gm)].map((m) => m[1])
}

const guardKeys = new Set<string>(guardMessageKeys)

describe('guard-surface catalog boundary (ADR-0023)', () => {
  for (const rel of HOST_CATALOGS) {
    it(`${rel} defines no guard-surface keys`, () => {
      const keys = catalogKeys(rel)
      expect(keys.length, 'catalog should keep its chrome keys').toBeGreaterThan(0)
      const drifted = keys.filter((k) => guardKeys.has(k))
      expect(drifted, 'keys that must live in the core shared catalog').toEqual([])
    })
  }

  it('the shared catalog is non-empty', () => {
    expect(guardKeys.size).toBeGreaterThan(0)
  })
})
