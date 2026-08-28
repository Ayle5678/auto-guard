import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AuditStore } from '../src/audit.ts'
import { loadAuditPassword, saveAuditPassword } from '../src/secret.ts'
import type { Decision } from '../src/types.ts'

const dirs: string[] = []
const stores: AuditStore[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pi-guard-enc-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (stores.length) stores.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function decision(): Decision {
  return { kind: 'allow', source: 'llm', risk: 'low', reason: 'secret reason' }
}

describe('AuditStore encryption', () => {
  it('stores sensitive fields encrypted when a password is provided', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const store = new AuditStore(dbPath, 'hunter2')
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

    expect(store.list()[0].command).toBe('echo secret-command')
    expect(store.list()[0].reason).toBe('secret reason')

    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = raw.prepare('SELECT command, command_normalized, reason, workspace, session_id FROM audit_log').get() as Record<string, unknown>
      expect(String(row.command)).toMatch(/^v1:/)
      expect(String(row.command_normalized)).toMatch(/^v1:/)
      expect(String(row.reason)).toMatch(/^v1:/)
      expect(String(row.workspace)).toMatch(/^v1:/)
      expect(String(row.session_id)).toMatch(/^v1:/)
    } finally {
      raw.close()
    }
  })

  it('migrates existing plaintext rows when opened with a password', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const plain = new AuditStore(dbPath)
    stores.push(plain)
    plain.insert({ source: 'tool_call', tool: 'bash', command: 'git status', decision: decision() })

    const encrypted = new AuditStore(dbPath, 'hunter2')
    stores.push(encrypted)
    const row = encrypted.list()[0]
    expect(row.command).toBe('git status')
    expect(row.reason).toBe('secret reason')
    expect(existsSync(`${dbPath}.before-encryption.db`)).toBe(true)

    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const stored = raw.prepare('SELECT command FROM audit_log').get() as { command: string }
      expect(stored.command).toMatch(/^v1:/)
    } finally {
      raw.close()
    }
  })

  it('keeps plaintext mode when no password is provided', () => {
    const store = new AuditStore(join(tmp(), 'audit.db'))
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'ls', decision: decision() })
    expect(store.list()[0].command).toBe('ls')
  })
})

describe('secret store', () => {
  it('round-trips an audit password', () => {
    const dir = tmp()
    saveAuditPassword(dir, 'correct horse battery staple')
    expect(loadAuditPassword(dir)).toBe('correct horse battery staple')
  })

  it('returns undefined when no password has been saved', () => {
    expect(loadAuditPassword(tmp())).toBeUndefined()
  })
})
