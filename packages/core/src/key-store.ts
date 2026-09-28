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
const FALLBACK_API_KEY_FILE = 'api-key-fallback.json'

interface ApiKeyFile {
  version: 1
  salt: string
  data: string
}

function saveApiKeyFile(dir: string, file: string, key: string): void {
  const machineKey = loadOrCreateMachineKey(dir)
  const salt = randomBytes(16)
  const fieldKey = deriveKey(machineKey.toString('hex'), salt)
  const payload = encryptField(fieldKey, key)
  const data: ApiKeyFile = { version: 1, salt: salt.toString('base64url'), data: payload }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** Decrypt the stored key; undefined when absent or undecryptable (never throws). */
function loadApiKeyFile(dir: string, file: string): string | undefined {
  const path = join(dir, file)
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

function clearApiKeyFile(dir: string, file: string): void {
  try {
    rmSync(join(dir, file), { force: true })
  } catch {
    // Already gone.
  }
}

export function saveApiKey(dir: string, key: string): void {
  saveApiKeyFile(dir, API_KEY_FILE, key)
}

export function loadApiKey(dir: string): string | undefined {
  return loadApiKeyFile(dir, API_KEY_FILE)
}

export function hasStoredApiKey(dir: string): boolean {
  return existsSync(join(dir, API_KEY_FILE))
}

export function clearApiKey(dir: string): void {
  clearApiKeyFile(dir, API_KEY_FILE)
}

/**
 * Backup-endpoint key slot (SPEC 0025): same encryption scheme as the primary
 * slot, separate file, so primary and fallback keys coexist in one root.
 */
export function saveFallbackApiKey(dir: string, key: string): void {
  saveApiKeyFile(dir, FALLBACK_API_KEY_FILE, key)
}

export function loadFallbackApiKey(dir: string): string | undefined {
  return loadApiKeyFile(dir, FALLBACK_API_KEY_FILE)
}

export function hasStoredFallbackApiKey(dir: string): boolean {
  return existsSync(join(dir, FALLBACK_API_KEY_FILE))
}

export function clearFallbackApiKey(dir: string): void {
  clearApiKeyFile(dir, FALLBACK_API_KEY_FILE)
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

/**
 * Resolve the backup endpoint key (SPEC 0025): env var named by
 * `config.fallbackApiKeyEnv`, then encrypted storage (via `loadStored`). No
 * legacy-plaintext layer — the fallback slot has no history. In-memory only,
 * like {@link hydrateApiKey}; mutates and returns `config`.
 */
export function hydrateFallbackApiKey(config: GuardConfig, loadStored: () => string | undefined = () => undefined): GuardConfig {
  if (config.fallbackApiKeyEnv && process.env[config.fallbackApiKeyEnv]) return config
  const stored = loadStored()
  if (stored) {
    config.fallbackApiKey = stored
    return config
  }
  return config
}
