import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearApiKey, hasStoredApiKey, loadApiKey, saveApiKey } from '../src/key-store.ts'

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
