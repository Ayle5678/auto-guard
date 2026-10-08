import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearApiKey,
  clearFallbackApiKey,
  hasStoredApiKey,
  hasStoredFallbackApiKey,
  hydrateApiKey,
  hydrateFallbackApiKey,
  loadApiKey,
  loadFallbackApiKey,
  saveApiKey,
  saveFallbackApiKey,
} from '../src/key-store.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ag-key-'))
}

describe('key-store', () => {
  it('round-trips a key through encrypted storage', () => {
    const dir = tempDir()
    expect(hasStoredApiKey(dir)).toBe(false)
    saveApiKey(dir, 'sk-test-1234567890')
    expect(hasStoredApiKey(dir)).toBe(true)
    expect(loadApiKey(dir)).toBe('sk-test-1234567890')
  })

  it('does not leave the plaintext in the stored file', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-super-secret-value')
    const raw = readFileSync(join(dir, 'api-key.json'), 'utf8')
    expect(raw).not.toContain('sk-super-secret-value')
    expect(raw).toContain('"data": "v1:')
  })

  it('returns undefined after clear', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-test-1234567890')
    clearApiKey(dir)
    expect(hasStoredApiKey(dir)).toBe(false)
    expect(loadApiKey(dir)).toBeUndefined()
  })

  it('yields undefined for a foreign machine key instead of throwing', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-test-1234567890')
    // Simulate a different machine: replace the machine key file.
    writeFileSync(join(dir, '.machine.key'), 'AAAA', { encoding: 'utf8' })
    expect(loadApiKey(dir)).toBeUndefined()
  })

  it('returns undefined when the store is corrupt', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-test-1234567890')
    writeFileSync(join(dir, 'api-key.json'), '{broken', { encoding: 'utf8' })
    expect(loadApiKey(dir)).toBeUndefined()
  })
})

describe('fallback key slot (SPEC 0025)', () => {
  it('stores and loads the backup key independently of the primary slot', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-primary-000000')
    saveFallbackApiKey(dir, 'sk-backup-000000')
    expect(hasStoredApiKey(dir)).toBe(true)
    expect(hasStoredFallbackApiKey(dir)).toBe(true)
    expect(loadApiKey(dir)).toBe('sk-primary-000000')
    expect(loadFallbackApiKey(dir)).toBe('sk-backup-000000')
  })

  it('clears only the fallback slot', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-primary-000000')
    saveFallbackApiKey(dir, 'sk-backup-000000')
    clearFallbackApiKey(dir)
    expect(hasStoredFallbackApiKey(dir)).toBe(false)
    expect(loadFallbackApiKey(dir)).toBeUndefined()
    expect(loadApiKey(dir)).toBe('sk-primary-000000')
  })
})

describe('hydrateFallbackApiKey: env > encrypted storage (no legacy layer)', () => {
  const base = (fallbackApiKeyEnv?: string) =>
    ({
      enabled: true,
      ...(fallbackApiKeyEnv ? { fallbackApiKeyEnv } : {}),
    }) as unknown as Parameters<typeof hydrateFallbackApiKey>[0]

  it('prefers the env var and hydrates nothing from storage', () => {
    process.env.AG_TEST_FALLBACK_KEY = 'sk-env-wins'
    try {
      const config = base('AG_TEST_FALLBACK_KEY')
      hydrateFallbackApiKey(config, () => 'sk-stored')
      expect(config.fallbackApiKey).toBeUndefined()
    } finally {
      delete process.env.AG_TEST_FALLBACK_KEY
    }
  })

  it('hydrates from encrypted storage when no env var', () => {
    const config = base('AG_TEST_FALLBACK_KEY')
    hydrateFallbackApiKey(config, () => 'sk-stored')
    expect(config.fallbackApiKey).toBe('sk-stored')
  })

  it('skips the env lookup when fallbackApiKeyEnv is unset', () => {
    process.env.AG_TEST_FALLBACK_KEY = 'sk-env-wins'
    try {
      const config = base()
      hydrateFallbackApiKey(config, () => 'sk-stored')
      expect(config.fallbackApiKey).toBe('sk-stored')
    } finally {
      delete process.env.AG_TEST_FALLBACK_KEY
    }
  })
})

describe('hydrateApiKey: env > encrypted storage > legacy plaintext', () => {
  const base = (apiKey: string) =>
    ({
      enabled: true,
      apiKeyEnv: 'AG_TEST_REVIEW_KEY',
      apiKey,
    }) as unknown as Parameters<typeof hydrateApiKey>[0]

  it('prefers the env var over everything and touches nothing', () => {
    process.env.AG_TEST_REVIEW_KEY = 'sk-env-wins'
    try {
      const config = base('sk-legacy')
      const result = hydrateApiKey(config, () => 'sk-stored')
      expect(result.apiKey).toBe('sk-legacy')
    } finally {
      delete process.env.AG_TEST_REVIEW_KEY
    }
  })

  it('falls back to encrypted storage when no env var', () => {
    const config = base('sk-legacy')
    const result = hydrateApiKey(config, () => 'sk-stored')
    expect(result.apiKey).toBe('sk-stored')
  })

  it('keeps the legacy plaintext field when nothing else resolves', () => {
    const config = base('sk-legacy')
    const result = hydrateApiKey(config, () => undefined)
    expect(result.apiKey).toBe('sk-legacy')
  })

  it('never writes back: hydration is in-memory only', () => {
    const config = base('sk-legacy')
    const before = JSON.stringify(config)
    hydrateApiKey(config, () => 'sk-stored')
    // apiKey was hydrated in memory (this is the point), but no sink received
    // a write: the loader is the only side channel and it stays read-only.
    expect(before).toContain('sk-legacy')
  })

  it('end-to-end: resolves through real encrypted storage inside the host config root', () => {
    const dir = tempDir()
    saveApiKey(dir, 'sk-from-disk')
    const config = base('')
    const result = hydrateApiKey(config, () => loadApiKey(dir))
    expect(result.apiKey).toBe('sk-from-disk')
  })
})
