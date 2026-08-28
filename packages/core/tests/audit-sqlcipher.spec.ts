import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { LightAuditStore, createAuditStore } from '../src/audit.ts'
import { SqlcipherAuditStore } from '../src/audit-sqlcipher.ts'
import { deriveKey, encryptField } from '../src/audit-crypto.ts'
import type { Decision } from '../src/types.ts'

const require = createRequire(import.meta.url)
interface CipherDB {
  exec(sql: string): unknown
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown; run(...params: unknown[]): unknown }
  pragma(source: string): unknown
  close(): void
}
const Database = require('better-sqlite3-multiple-ciphers') as new (path: string) => CipherDB

const dirs: string[] = []
const stores: Array<{ close(): void }> = []

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-sqlcipher-'))
  dirs.push(d)
  return d
}

function decision(): Decision {
  return { kind: 'allow', source: 'llm', risk: 'low', reason: 'secret reason' }
}

function createLegacyTable(db: CipherDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      session_id TEXT,
      workspace TEXT,
      source TEXT NOT NULL,
      tool TEXT NOT NULL,
      command TEXT NOT NULL,
      command_normalized TEXT NOT NULL,
      decision_kind TEXT NOT NULL,
      final_action TEXT,
      decision_source TEXT NOT NULL,
      risk TEXT,
      category TEXT,
      rule_pattern TEXT,
      reason TEXT,
      reviewer_failed INTEGER NOT NULL DEFAULT 0,
      cached INTEGER NOT NULL DEFAULT 0,
      needs_reason INTEGER NOT NULL DEFAULT 0,
      extra TEXT
    )
  `)
}

function seedLegacy(dbPath: string, command = 'git status'): void {
  const db = new Database(dbPath)
  try {
    createLegacyTable(db)
    db.prepare(`
      INSERT INTO audit_log (recorded_at, source, tool, command, command_normalized, decision_kind, decision_source, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), 'tool_call', 'bash', command, command, 'allow', 'static-allow', 'ok')
  } finally {
    db.close()
  }
}

afterEach(() => {
  while (stores.length) stores.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('SqlcipherAuditStore', () => {
  it('does not create a database file when no password is provided', () => {
    const dbPath = join(tmp(), 'audit.db')
    const store = new SqlcipherAuditStore(dbPath)
    stores.push(store)

    expect(existsSync(dbPath)).toBe(false)
    expect(store.count()).toBe(0)
    expect(store.list()).toEqual([])
  })

  it('creates an encrypted SQLCipher database and stores records', () => {
    const dbPath = join(tmp(), 'audit.db')
    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)

    store.insert({
      sessionId: 's1',
      workspace: '/work',
      source: 'tool_call',
      tool: 'bash',
      command: 'echo secret-command',
      decision: decision(),
      finalAction: 'allow',
    })

    expect(store.count()).toBe(1)
    expect(store.list()[0].command).toBe('echo secret-command')
    expect(store.encryptionLevel()).toBe('sqlcipher')
    expect(existsSync(dbPath)).toBe(true)

    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      expect(() => raw.prepare('SELECT count(*) FROM audit_log').get()).toThrow()
    } finally {
      raw.close()
    }
  })

  it('migrates an existing plaintext SQLite database when a password is provided', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    seedLegacy(dbPath, 'git status')

    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)

    expect(existsSync(`${dbPath}.before-sqlcipher.db`)).toBe(true)
    expect(store.count()).toBe(1)
    expect(store.list()[0].command).toBe('git status')
    expect(store.list()[0].reason).toBe('ok')
  })

  it('decrypts old field-encrypted rows during migration', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const salt = Buffer.from('TEST_SALT_123')
    writeFileSync(`${dbPath}.salt`, salt.toString('base64url'), 'utf8')
    const key = deriveKey('hunter2', salt)

    const db = new Database(dbPath)
    try {
      createLegacyTable(db)
      db.prepare(`
        INSERT INTO audit_log (recorded_at, source, tool, command, command_normalized, decision_kind, decision_source, reason, workspace, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        new Date().toISOString(),
        'tool_call',
        'bash',
        encryptField(key, 'echo secret-command'),
        encryptField(key, 'echo secret-command'),
        'allow',
        'static-allow',
        encryptField(key, 'secret reason'),
        encryptField(key, '/work'),
        encryptField(key, 's1'),
      )
    } finally {
      db.close()
    }

    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)

    const row = store.list()[0]
    expect(row.command).toBe('echo secret-command')
    expect(row.command_normalized).toBe('echo secret-command')
    expect(row.reason).toBe('secret reason')
    expect(row.workspace).toBe('/work')
    expect(row.session_id).toBe('s1')
  })

  it('rekeys an existing SQLCipher database and keeps data readable with the new password', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const store = new SqlcipherAuditStore(dbPath, 'old-password')
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'echo secret', decision: decision() })

    expect(store.rekey('new-password')).toBe(true)
    store.close()

    const reopened = new SqlcipherAuditStore(dbPath, 'new-password')
    stores.push(reopened)
    expect(reopened.count()).toBe(1)
    expect(reopened.list()[0].command).toBe('echo secret')

    const raw = new Database(dbPath)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.pragma("key='old-password'")
      expect(() => raw.prepare('SELECT * FROM audit_log').all()).toThrow()
    } finally {
      raw.close()
    }
  })

  it('does not orphan an existing encrypted database on a wrong password', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const first = new SqlcipherAuditStore(dbPath, 'old-password')
    stores.push(first)
    first.insert({ source: 'tool_call', tool: 'bash', command: 'old', decision: decision() })
    first.close()

    const second = new SqlcipherAuditStore(dbPath, 'new-password')
    stores.push(second)

    expect(readdirSync(dir).some((f) => f.startsWith('audit.db.orphan-'))).toBe(false)
    expect(second.count()).toBe(0)
    expect(existsSync(dbPath)).toBe(true)
  })

  it('creates a fresh empty database only when explicitly requested', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const first = new SqlcipherAuditStore(dbPath, 'old-password')
    stores.push(first)
    first.insert({ source: 'tool_call', tool: 'bash', command: 'old', decision: decision() })
    first.close()

    const second = new SqlcipherAuditStore(dbPath, 'new-password')
    stores.push(second)

    expect(second.createNew('new-password')).toBe(true)
    expect(readdirSync(dir).some((f) => f.startsWith('audit.db.orphan-'))).toBe(true)
    expect(second.count()).toBe(0)
    expect(existsSync(dbPath)).toBe(true)
  })

  it('disables the store when the password is cleared while keeping the file', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'echo secret', decision: decision() })

    store.setPassword('')

    expect(store.count()).toBe(0)
    expect(store.list()).toEqual([])
    expect(existsSync(dbPath)).toBe(true)
  })

  it('exports the audit database as a plaintext SQLite file', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'echo secret', decision: decision() })

    const dest = join(dir, 'export.db')
    expect(store.exportPlaintext(dest)).toBe(true)

    const out = new Database(dest)
    try {
      expect(out.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).toEqual({ c: 1 })
      expect(out.prepare('SELECT command FROM audit_log').get()).toEqual({ command: 'echo secret' })
    } finally {
      out.close()
    }
  })

  it('overwrites an existing plaintext export instead of appending', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const dest = join(dir, 'export.db')
    const store = new SqlcipherAuditStore(dbPath, 'hunter2')
    stores.push(store)

    store.insert({ source: 'tool_call', tool: 'bash', command: 'first', decision: decision() })
    expect(store.exportPlaintext(dest)).toBe(true)

    store.insert({ source: 'tool_call', tool: 'bash', command: 'second', decision: decision() })
    expect(store.exportPlaintext(dest)).toBe(true)

    const out = new Database(dest)
    try {
      expect(out.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).toEqual({ c: 2 })
    } finally {
      out.close()
    }
  })
})

describe('createAuditStore factory', () => {
  it('prefers SQLCipher when the optional module is available', () => {
    const dbPath = join(tmp(), 'audit.db')
    const store = createAuditStore(dbPath, 'hunter2')
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'x', decision: decision() })
    expect(store.count()).toBe(1)
    // Native module is present in this workspace, so the factory must pick it.
    expect(store.encryptionLevel()).toBe('sqlcipher')
  })

  it('falls back to the Light store without a password', () => {
    const dbPath = join(tmp(), 'audit.db')
    const store = createAuditStore(dbPath)
    stores.push(store)
    expect(store).toBeInstanceOf(LightAuditStore)
    expect(store.encryptionLevel()).toBe('none')
    store.insert({ source: 'tool_call', tool: 'bash', command: 'x', decision: decision() })
    expect(store.count()).toBe(1)
  })
})
