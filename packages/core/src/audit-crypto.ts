/**
 * Field-level AES-256-GCM helpers for the audit log.
 *
 * Sensitive free-text columns are encrypted before they reach SQLite so a
 * casual reader cannot see command history. This is obfuscation-grade local
 * protection, not a full-database encryption boundary.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH)
}

export function encryptField(key: Buffer, value: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptField(key: Buffer, payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported encrypted payload')
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const data = Buffer.from(parts[3], 'base64url')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncrypted(value: string): boolean {
  return value.startsWith('v1:')
}
