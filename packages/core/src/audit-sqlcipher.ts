/**
 * SQLCipher-backed audit store (ADR-0005, "capable" implementation).
 *
 * Full-database encryption via better-sqlite3-multiple-ciphers (optional
 * dependency). Ported from dsh-auto-guard 0.2.0: WAL mode, rekey, plaintext
 * export, and one-time migration of legacy plaintext / field-encrypted
 * databases with a backup copy kept before the switch.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { expandHome, normalizeCommand } from './command.ts'
import { decryptField, deriveKey, isEncrypted } from './audit-crypto.ts'
import { redactCommand, SCHEMA_DDL, type AuditEncryptionLevel, type AuditRecordInput, type AuditRow } from './audit.ts'

const require = createRequire(import.meta.url)

interface SQLiteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface SQLiteDB {
  close(): void
  exec(sql: string): unknown
  pragma(source: string): unknown
  prepare(sql: string): SQLiteStatement
}

type SqliteConstructor = new (filePath: string) => SQLiteDB
let sqliteConstructor: SqliteConstructor | undefined
let sqliteLoadError: unknown

function loadSqliteConstructor(): SqliteConstructor {
  if (!sqliteConstructor && !sqliteLoadError) {
    try {
      sqliteConstructor = require('better-sqlite3-multiple-ciphers') as SqliteConstructor
    } catch (error) {
      sqliteLoadError = error
    }
  }
  if (sqliteLoadError) throw sqliteLoadError
  return sqliteConstructor!
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * Best-effort SQLCipher audit store. If no password is provided the store is
 * a no-op and never creates or opens a database file. If the database cannot
 * be opened or a write fails, methods no-op instead of throwing so the guard
 * pipeline is unaffected.
 */
export class SqlcipherAuditStore {
  private db: SQLiteDB | null = null
  private readonly resolvedPath: string
  private password = ''

  constructor(dbPath: string, password = '') {
    this.resolvedPath = expandHome(dbPath)
    this.password = password || ''
    if (!this.password) return
    try {
      this.open(this.password)
    } catch {
      this.close()
    }
  }

  private open(password: string): void {
    const path = this.resolvedPath
    loadSqliteConstructor()
    mkdirSync(dirname(path), { recursive: true })
    try {
      this.db = this.openSqlCipher(password, path)
      this.password = password
      return
    } catch {
      if (!existsSync(path)) throw new Error('Unable to create SQLCipher database')
      const plain = this.tryOpenPlain(path)
      if (plain) {
        this.migrateLegacy(plain, path, password)
        return
      }
      // Existing encrypted database cannot be opened with this password. Keep
      // the original file untouched; creating a new database is an explicit
      // user action so a typo does not silently orphan the old audit history.
      this.db = null
    }
  }

  createNew(password: string): boolean {
    if (!password) return false
    const path = this.resolvedPath
    try {
      loadSqliteConstructor()
      this.close()
      if (existsSync(path)) {
        const orphan = `${path}.orphan-${timestamp()}`
        renameSync(path, orphan)
      }
      this.db = this.openSqlCipher(password, path)
      this.password = password
      return true
    } catch {
      this.close()
      return false
    }
  }

  private openSqlCipher(password: string, filePath = this.resolvedPath): SQLiteDB {
    const db = new (loadSqliteConstructor())(filePath)
    try {
      db.pragma(`cipher=${sqlString('sqlcipher')}`)
      db.pragma('legacy=4')
      db.pragma(`key=${sqlString(password)}`)
      db.pragma('journal_mode=WAL')
      this.ensureSchema(db)
      return db
    } catch (error) {
      try {
        db.close()
      } catch {
        // ignore
      }
      throw error
    }
  }

  private tryOpenPlain(filePath: string): SQLiteDB | null {
    let db: SQLiteDB | null = null
    try {
      db = new (loadSqliteConstructor())(filePath)
      db.prepare('SELECT id FROM audit_log LIMIT 1').get()
      return db
    } catch {
      try {
        db?.close()
      } catch {
        // ignore
      }
      return null
    }
  }

  private migrateLegacy(old: SQLiteDB, path: string, password: string): void {
    try {
      const rows = old.prepare('SELECT * FROM audit_log ORDER BY id').all() as unknown as AuditRow[]
      const saltPath = `${path}.salt`
      const oldKey = existsSync(saltPath)
        ? deriveKey(password, Buffer.from(readFileSync(saltPath, 'utf8').trim(), 'base64url'))
        : undefined
      const cleanRows = rows.map((row) => this.decryptRow(row, oldKey))
      old.close()

      const backup = `${path}.before-sqlcipher.db`
      if (!existsSync(backup)) copyFileSync(path, backup)

      const tmp = `${path}.sqlcipher-tmp`
      rmSync(tmp, { force: true })
      const fresh = this.openSqlCipher(password, tmp)
      try {
        const insert = fresh.prepare(`
          INSERT INTO audit_log (
            recorded_at, session_id, workspace, source, tool, command, command_normalized,
            decision_kind, final_action, decision_source, risk, category, rule_pattern, reason,
            reviewer_failed, cached, needs_reason, extra
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const row of cleanRows) {
          insert.run(
            row.recorded_at,
            row.session_id,
            row.workspace,
            row.source,
            row.tool,
            row.command,
            row.command_normalized,
            row.decision_kind,
            row.final_action,
            row.decision_source,
            row.risk,
            row.category,
            row.rule_pattern,
            row.reason,
            row.reviewer_failed,
            row.cached,
            row.needs_reason,
            row.extra,
          )
        }
      } finally {
        fresh.close()
      }

      if (existsSync(path)) rmSync(path, { force: true })
      renameSync(tmp, path)
      this.db = this.openSqlCipher(password, path)
      this.password = password
    } catch (error) {
      try {
        old.close()
      } catch {
        // ignore
      }
      throw error
    }
  }

  private decryptRow(row: AuditRow, key?: Buffer): AuditRow {
    if (!key) return row
    const dec = (value: string | null): string | null => {
      if (value === null || !isEncrypted(value)) return value
      try {
        return decryptField(key, value)
      } catch {
        return value
      }
    }
    return {
      ...row,
      command: dec(row.command) ?? '',
      command_normalized: dec(row.command_normalized) ?? '',
      reason: dec(row.reason),
      workspace: dec(row.workspace),
      session_id: dec(row.session_id),
      extra: dec(row.extra),
    }
  }

  private ensureSchema(db: SQLiteDB): void {
    db.exec(SCHEMA_DDL)
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(recorded_at)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_command ON audit_log(command_normalized)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision_kind, decision_source)')
  }

  encryptionLevel(): AuditEncryptionLevel {
    return this.db ? 'sqlcipher' : 'none'
  }

  insert(input: AuditRecordInput): void {
    const db = this.db
    if (!db) return
    try {
      const redacted = redactCommand(input.command)
      const stmt = db.prepare(`
        INSERT INTO audit_log (
          recorded_at, session_id, workspace, source, tool, command, command_normalized,
          decision_kind, final_action, decision_source, risk, category, rule_pattern, reason,
          reviewer_failed, cached, needs_reason, extra
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        input.recordedAt ?? new Date().toISOString(),
        input.sessionId ?? null,
        input.workspace ?? null,
        input.source,
        input.tool,
        redacted,
        normalizeCommand(redacted),
        input.decision.kind,
        input.finalAction ?? null,
        input.decision.source,
        input.decision.risk ?? null,
        input.decision.category ?? null,
        input.rulePattern ?? null,
        input.decision.reason ?? null,
        input.decision.reviewerFailed ? 1 : 0,
        input.decision.cached ? 1 : 0,
        input.decision.needsReason ? 1 : 0,
        null,
      )
    } catch {
      // best-effort audit: never let storage failures escape
    }
  }

  list(): AuditRow[] {
    const db = this.db
    if (!db) return []
    try {
      return db.prepare('SELECT * FROM audit_log ORDER BY id').all() as unknown as AuditRow[]
    } catch {
      return []
    }
  }

  count(): number {
    const db = this.db
    if (!db) return 0
    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as { count: number }
      return Number(row.count)
    } catch {
      return 0
    }
  }

  clearOld(days: number): number {
    const db = this.db
    if (!db) return 0
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      const result = db.prepare('DELETE FROM audit_log WHERE recorded_at < ?').run(cutoff)
      return Number(result.changes ?? 0)
    } catch {
      return 0
    }
  }

  clearAll(): void {
    const db = this.db
    if (!db) return
    try {
      db.exec('DELETE FROM audit_log')
    } catch {
      // best-effort
    }
  }

  rekey(newPassword: string): boolean {
    const db = this.db
    if (!db || !newPassword) return false
    try {
      db.pragma(`rekey=${sqlString(newPassword)}`)
      this.password = newPassword
      return true
    } catch {
      return false
    }
  }

  setPassword(password?: string): void {
    const next = (password ?? '').trim()
    if (!next) {
      this.close()
      this.password = ''
      return
    }
    if (!this.db) {
      try {
        this.open(next)
      } catch {
        this.close()
      }
      return
    }
    if (next === this.password) return
    this.rekey(next)
  }

  exportPlaintext(destPath: string): boolean {
    const db = this.db
    if (!db) return false
    try {
      const dest = expandHome(destPath)
      mkdirSync(dirname(dest), { recursive: true })
      rmSync(dest, { force: true })
      rmSync(`${dest}-wal`, { force: true })
      rmSync(`${dest}-shm`, { force: true })
      const out = new (loadSqliteConstructor())(dest)
      try {
        this.ensureSchema(out)
        const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as unknown as AuditRow[]
        const insert = out.prepare(`
          INSERT INTO audit_log (
            recorded_at, session_id, workspace, source, tool, command, command_normalized,
            decision_kind, final_action, decision_source, risk, category, rule_pattern, reason,
            reviewer_failed, cached, needs_reason, extra
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const row of rows) {
          insert.run(
            row.recorded_at,
            row.session_id,
            row.workspace,
            row.source,
            row.tool,
            row.command,
            row.command_normalized,
            row.decision_kind,
            row.final_action,
            row.decision_source,
            row.risk,
            row.category,
            row.rule_pattern,
            row.reason,
            row.reviewer_failed,
            row.cached,
            row.needs_reason,
            row.extra,
          )
        }
        out.close()
      } catch (error) {
        try {
          out.close()
        } catch {
          // ignore
        }
        throw error
      }
      return true
    } catch {
      return false
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // ignore
    }
    this.db = null
  }
}
