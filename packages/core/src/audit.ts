/**
 * Experimental local audit log for guard decisions.
 *
 * Stores one row per guarded shell command decision in a local SQLite database
 * (WAL mode). It intentionally does NOT store command execution output. All
 * storage operations are best-effort: failures are swallowed so auditing can
 * never block or alter command execution.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { expandHome, normalizeCommand } from './command.ts'
import { decryptField, deriveKey, encryptField, isEncrypted } from './audit-crypto.ts'
import type { Decision } from './types.ts'

export interface AuditRecordInput {
  sessionId?: string
  workspace?: string
  source: 'tool_call' | 'user_bash'
  tool: string
  command: string
  decision: Decision
  finalAction?: 'allow' | 'block'
  rulePattern?: string
  /** Test seam: defaults to now when omitted. */
  recordedAt?: string
}

export interface AuditRow {
  id: number
  recorded_at: string
  session_id: string | null
  workspace: string | null
  source: string
  tool: string
  command: string
  command_normalized: string
  decision_kind: string
  final_action: string | null
  decision_source: string
  risk: string | null
  category: string | null
  rule_pattern: string | null
  reason: string | null
  reviewer_failed: number
  cached: number
  needs_reason: number
  extra: string | null
}

const SECRET_KEY_VALUE =
  /(\b(?:token|password|passwd|secret|api[_-]?key)\b\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s]+@/gi
const SK_API_KEY = /\bsk-[A-Za-z0-9_-]+/gi

/** Mask common secret shapes before a command is persisted to the audit log. */
export function redactCommand(command: string): string {
  return command
    .replace(URL_CREDENTIALS, '$1***@')
    .replace(BEARER_TOKEN, 'Bearer ***')
    .replace(SECRET_KEY_VALUE, '$1***')
    .replace(SK_API_KEY, 'sk-***')
}

/**
 * Best-effort SQLite audit store. If the database cannot be opened or a write
 * fails, methods no-op instead of throwing so the guard pipeline is unaffected.
 */
export class AuditStore {
  private db: DatabaseSync | null
  private readonly key?: Buffer

  constructor(dbPath: string, password?: string) {
    let db: DatabaseSync | null = null
    try {
      const resolved = expandHome(dbPath)
      mkdirSync(dirname(resolved), { recursive: true })
      if (password) {
        const saltPath = `${resolved}.salt`
        let salt: Buffer
        if (existsSync(saltPath)) {
          salt = Buffer.from(readFileSync(saltPath, 'utf8').trim(), 'base64url')
        } else {
          salt = randomBytes(16)
          writeFileSync(saltPath, salt.toString('base64url'), { encoding: 'utf8' })
        }
        this.key = deriveKey(password, salt)
      }
      db = new DatabaseSync(resolved)
      db.exec('PRAGMA journal_mode=WAL')
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
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(recorded_at)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_command ON audit_log(command_normalized)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision_kind, decision_source)')
      if (this.key) {
        if (existsSync(resolved) && !existsSync(`${resolved}.before-encryption.db`)) {
          copyFileSync(resolved, `${resolved}.before-encryption.db`)
        }
        this.migratePlaintext(db, this.key)
      }
    } catch {
      try {
        db?.close()
      } catch {
        // ignore
      }
      db = null
    }
    this.db = db
  }

  private encryptValue(value: string | null): string | null {
    if (value === null || value === undefined || !this.key) return value
    return encryptField(this.key, value)
  }

  private decryptValue(value: string | null): string | null {
    if (value === null || value === undefined || !this.key) return value
    if (!isEncrypted(value)) return value
    try {
      return decryptField(this.key, value)
    } catch {
      return value
    }
  }

  private migratePlaintext(db: DatabaseSync, key: Buffer): void {
    try {
      const rows = db.prepare('SELECT id, command, command_normalized, reason, workspace, session_id, extra FROM audit_log').all() as Array<{
        id: number
        command: string | null
        command_normalized: string | null
        reason: string | null
        workspace: string | null
        session_id: string | null
        extra: string | null
      }>
      const update = db.prepare(
        'UPDATE audit_log SET command = ?, command_normalized = ?, reason = ?, workspace = ?, session_id = ?, extra = ? WHERE id = ?',
      )
      for (const row of rows) {
        if (row.command && isEncrypted(row.command)) continue
        update.run(
          row.command ? encryptField(key, row.command) : null,
          row.command_normalized ? encryptField(key, row.command_normalized) : null,
          row.reason ? encryptField(key, row.reason) : null,
          row.workspace ? encryptField(key, row.workspace) : null,
          row.session_id ? encryptField(key, row.session_id) : null,
          row.extra ? encryptField(key, row.extra) : null,
          row.id,
        )
      }
    } catch {
      // Best-effort migration; never break audit availability.
    }
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
        this.encryptValue(input.sessionId ?? null),
        this.encryptValue(input.workspace ?? null),
        input.source,
        input.tool,
        this.encryptValue(redacted),
        this.encryptValue(normalizeCommand(redacted)),
        input.decision.kind,
        input.finalAction ?? null,
        input.decision.source,
        input.decision.risk ?? null,
        input.decision.category ?? null,
        input.rulePattern ?? null,
        this.encryptValue(input.decision.reason ?? null),
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
      const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as unknown as AuditRow[]
      return rows.map((row) => ({
        ...row,
        command: this.decryptValue(row.command) ?? '',
        command_normalized: this.decryptValue(row.command_normalized) ?? '',
        reason: this.decryptValue(row.reason),
        workspace: this.decryptValue(row.workspace),
        session_id: this.decryptValue(row.session_id),
        extra: this.decryptValue(row.extra),
      }))
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

  close(): void {
    try {
      this.db?.close()
    } catch {
      // ignore
    }
    this.db = null
  }
}
