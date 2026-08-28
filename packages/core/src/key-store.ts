/**
 * Encrypted local storage for the review API key.
 *
 * Mirrors the audit-password scheme: a machine-bound random key sits next to
 * the ciphertext so the guard can unlock the key without prompting, while
 * `config.json` itself never carries the plaintext (upgrade over legacy plaintext configs,
 * which stored the key in plaintext per its ADR-0009). Obfuscation-grade local
 * protection, not a hardware-backed secret store.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { decryptField, deriveKey, encryptField } from './audit-crypto.ts'
import { loadOrCreateMachineKey } from './secret.ts'
import type { GuardConfig } from './types.ts'

const API_KEY_FILE = 'api-key.json'

interface ApiKeyFile {
  version: 1
  salt: string
  data: string
}

export function saveApiKey(dir: string, key: string): void {
  const machineKey = loadOrCreateMachineKey(dir)
  const salt = randomBytes(16)
  const fieldKey = deriveKey(machineKey.toString('hex'), salt)
  const payload = encryptField(fieldKey, key)
  const data: ApiKeyFile = { version: 1, salt: salt.toString('base64url'), data: payload }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, API_KEY_FILE), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** Decrypt the stored key; undefined when absent or undecryptable (never throws). */
export function loadApiKey(dir: string): string | undefined {
  const path = join(dir, API_KEY_FILE)
  if (!existsSync(path)) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ApiKeyFile>
    if (!raw.salt || !raw.data) return undefined
    const machineKey = loadOrCreateMachineKey(dir)
    const fieldKey = deriveKey(machineKey.toString('hex'), Buffer.from(raw.salt, 'base64url'))
    return decryptField(fieldKey, raw.data)
  } catch {
    return undefined
  }
}

export function hasStoredApiKey(dir: string): boolean {
  return existsSync(join(dir, API_KEY_FILE))
}

export function clearApiKey(dir: string): void {
  try {
    rmSync(join(dir, API_KEY_FILE), { force: true })
  } catch {
    // Already gone.
  }
}

/**
 * Resolve the review API key in priority order (ADR-0006): env var named by
 * `config.apiKeyEnv`, then encrypted storage (via `loadStored`), then the
 * legacy plaintext `config.apiKey` field. Hydration happens in memory only —
 * the legacy plaintext field is never rewritten, so no write path can reach
 * it. Mutates and returns `config` so callers can pass it straight on.
 */
export function hydrateApiKey(config: GuardConfig, loadStored: () => string | undefined = () => undefined): GuardConfig {
  if (process.env[config.apiKeyEnv]) return config
  const stored = loadStored()
  if (stored) {
    config.apiKey = stored
    return config
  }
  return config
}
