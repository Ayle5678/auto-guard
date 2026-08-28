import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore as AuditStore, redactCommand } from '../src/audit.ts'
import type { Decision } from '../src/types.ts'

const dirs: string[] = []
const stores: AuditStore[] = []

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pi-guard-audit-'))
  dirs.push(d)
  return d
}

function createStore(): AuditStore {
  const store = new AuditStore(join(tmp(), 'audit.db'))
  stores.push(store)
  return store
}

afterEach(() => {
  while (stores.length) stores.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'allow', source: 'static-allow', ...overrides }
}

describe('redactCommand', () => {
  it('masks sk- API keys', () => {
    const redacted = redactCommand('curl -H "Authorization: Bearer sk-abc123DEF456" https://api.example.com')
    expect(redacted).toContain('Bearer ***')
    expect(redacted).not.toContain('sk-abc123DEF456')
    expect(redactCommand('export KEY=sk-abc123DEF456')).not.toContain('sk-abc123DEF456')
  })

  it('masks token/password/secret key-value pairs', () => {
    expect(redactCommand('curl -H "Authorization: Bearer abc123" https://api.example.com')).not.toContain('abc123')
    expect(redactCommand('export TOKEN=secret-token')).toBe('export TOKEN=***')
    expect(redactCommand('export PASSWORD="hunter2"')).not.toContain('hunter2')
    expect(redactCommand('--api_key=1234567890')).toBe('--api_key=***')
  })

  it('masks URL credentials', () => {
    expect(redactCommand('git clone https://user:pass@example.com/repo.git')).toBe('git clone https://***@example.com/repo.git')
  })

  it('leaves ordinary commands unchanged', () => {
    expect(redactCommand('git status')).toBe('git status')
    expect(redactCommand('ls -la')).toBe('ls -la')
  })
})

describe('AuditStore', () => {
  it('creates the audit table and inserts a record', () => {
    const store = createStore()
    store.insert({
      sessionId: 's1',
      workspace: '/work',
      source: 'tool_call',
      tool: 'bash',
      command: 'git status',
      decision: decision({ kind: 'allow', source: 'static-allow', category: 'static-allow', reason: 'read-only' }),
      finalAction: 'allow',
      rulePattern: 'git *',
    })
    expect(store.count()).toBe(1)
  })

  it('stores redacted command and normalized command', () => {
    const store = createStore()
    store.insert({
      source: 'user_bash',
      tool: 'bash',
      command: 'echo TOKEN=abc123',
      decision: decision({ kind: 'allow' }),
    })
    const row = store.list()[0]
    expect(row.command).toBe('echo TOKEN=***')
    expect(row.command_normalized).toBe('echo TOKEN=***')
  })

  it('clears only records older than the given cutoff', () => {
    const store = createStore()
    store.insert({
      source: 'tool_call',
      tool: 'bash',
      command: 'old',
      decision: decision(),
      recordedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    })
    store.insert({
      source: 'tool_call',
      tool: 'bash',
      command: 'new',
      decision: decision(),
      recordedAt: new Date().toISOString(),
    })
    expect(store.clearOld(30)).toBe(1)
    expect(store.count()).toBe(1)
    expect(store.list()[0].command).toBe('new')
  })

  it('clears all records', () => {
    const store = createStore()
    store.insert({ source: 'tool_call', tool: 'bash', command: 'a', decision: decision() })
    store.insert({ source: 'user_bash', tool: 'pwsh', command: 'b', decision: decision() })
    store.clearAll()
    expect(store.count()).toBe(0)
  })

  it('does not throw when the store is unavailable', () => {
    const store = createStore()
    store.close()
    expect(() => store.insert({ source: 'tool_call', tool: 'bash', command: 'x', decision: decision() })).not.toThrow()
    expect(store.clearOld(30)).toBe(0)
    expect(store.count()).toBe(0)
  })
})
