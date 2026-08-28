/**
 * Local encrypted storage for the audit password.
 *
 * A machine-bound random key is kept next to the encrypted secret so the
 * extension can unlock the audit DB without prompting on every decision. This
 * prevents casual file reads but is not a hardware-backed secret store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { decryptField, encryptField, deriveKey } from './audit-crypto.ts'

const MACHINE_KEY_FILE = '.machine.key'
const AUDIT_SECRET_FILE = 'audit-secret.json'

export function loadOrCreateMachineKey(dir: string): Buffer {
  const path = join(dir, MACHINE_KEY_FILE)
  if (existsSync(path)) {
    return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64')
  }
  mkdirSync(dir, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(path, key.toString('base64'), { encoding: 'utf8', mode: 0o600 })
  return key
}

export function saveAuditPassword(dir: string, password: string): void {
  const machineKey = loadOrCreateMachineKey(dir)
  const salt = randomBytes(16)
  const key = deriveKey(machineKey.toString('hex'), salt)
  const payload = encryptField(key, password)
  const data = { version: 1, salt: salt.toString('base64url'), data: payload }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, AUDIT_SECRET_FILE), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function loadAuditPassword(dir: string): string | undefined {
  const path = join(dir, AUDIT_SECRET_FILE)
  if (!existsSync(path)) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { salt?: string; data?: string }
    if (!raw.salt || !raw.data) return undefined
    const machineKey = loadOrCreateMachineKey(dir)
    const key = deriveKey(machineKey.toString('hex'), Buffer.from(raw.salt, 'base64url'))
    return decryptField(key, raw.data)
  } catch {
    return undefined
  }
}
