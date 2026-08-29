/**
 * Interface contract shared by both audit store implementations (ADR-0005).
 * History and learned-rule analysis depend only on this surface.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore } from '../src/audit.ts'
import { SqlcipherAuditStore } from '../src/audit-sqlcipher.ts'
import type { AuditStore } from '../src/audit.ts'
import type { Decision } from '../src/types.ts'

const dirs: string[] = []
const stores: Array<{ close(): void }> = []

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-audit-contract-'))
  dirs.push(d)
  return d
}

function decision(): Decision {
  return { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' }
}

const factories: Array<{ name: string; make: () => AuditStore }> = [
  { name: 'LightAuditStore (node:sqlite + field AES-GCM)', make: () => new LightAuditStore(join(tmp(), 'light.db'), 'pw') },
  { name: 'SqlcipherAuditStore (full-db encryption)', make: () => new SqlcipherAuditStore(join(tmp(), 'cipher.db'), 'pw') },
]

afterEach(() => {
  while (stores.length) stores.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe.each(factories)('audit contract: $name', ({ make }) => {
  it('insert + list round-trips a redacted record', () => {
    const store = make()
    stores.push(store)
    store.insert({
      sessionId: 's1',
      workspace: '/work',
      source: 'tool_call',
      tool: 'bash',
      command: 'git push https://user:pw@host/x.git',
      decision: decision(),
      finalAction: 'allow',
      rulePattern: 'git push*',
    })
    const rows = store.list()
    expect(rows).toHaveLength(1)
    // redaction is shared behavior
    expect(rows[0].command).not.toContain('user:pw@')
    expect(rows[0].decision_kind).toBe('allow')
    expect(rows[0].rule_pattern).toBe('git push*')
  })

  it('count reflects inserted rows', () => {
    const store = make()
    stores.push(store)
    expect(store.count()).toBe(0)
    store.insert({ source: 'user_bash', tool: 'bash', command: 'ls', decision: decision() })
    store.insert({ source: 'user_bash', tool: 'bash', command: 'pwd', decision: decision() })
    expect(store.count()).toBe(2)
  })

  it('clearOld removes only rows older than the cutoff', () => {
    const store = make()
    stores.push(store)
    store.insert({
      source: 'tool_call',
      tool: 'bash',
      command: 'old',
      decision: decision(),
      recordedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    })
    store.insert({ source: 'tool_call', tool: 'bash', command: 'new', decision: decision() })
    expect(store.clearOld(5)).toBe(1)
    expect(store.count()).toBe(1)
    expect(store.list()[0].command).toBe('new')
  })

  it('clearAll empties the log', () => {
    const store = make()
    stores.push(store)
    store.insert({ source: 'tool_call', tool: 'bash', command: 'x', decision: decision() })
    store.clearAll()
    expect(store.count()).toBe(0)
  })

  it('summarizeSince aggregates kinds and sources inside the window only', () => {
    const store = make()
    stores.push(store)
    const day = 24 * 60 * 60 * 1000
    const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
    store.insert({ source: 'tool_call', tool: 'bash', command: 'a', decision: { kind: 'allow', source: 'llm', risk: 'low' }, recordedAt: ago(0.1) })
    store.insert({ source: 'tool_call', tool: 'bash', command: 'b', decision: { kind: 'allow', source: 'static-allow' }, recordedAt: ago(0.2) })
    store.insert({ source: 'tool_call', tool: 'bash', command: 'c', decision: { kind: 'deny', source: 'hard-deny' }, recordedAt: ago(0.3) })
    store.insert({ source: 'tool_call', tool: 'bash', command: 'd', decision: { kind: 'ask', source: 'llm', risk: 'medium', reviewerFailed: true }, recordedAt: ago(0.4) })
    store.insert({ source: 'tool_call', tool: 'bash', command: 'old', decision: { kind: 'allow', source: 'llm', risk: 'low' }, recordedAt: ago(10) })

    const summary = store.summarizeSince(7)
    expect(summary.total).toBe(4)
    expect(summary.allow).toBe(2)
    expect(summary.deny).toBe(1)
    expect(summary.ask).toBe(1)
    expect(summary.reviewerFailed).toBe(1)
    expect(summary.dbTotal).toBe(5)
    expect(summary.bySource).toEqual([
      { source: 'llm', count: 2 },
      { source: 'hard-deny', count: 1 },
      { source: 'static-allow', count: 1 },
    ])

    // widening the window pulls the 10-day-old row back in
    expect(store.summarizeSince(30).total).toBe(5)
  })
})
