import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditStore } from '../src/audit.ts'
import { HistoryStore } from '../src/history.ts'
import type { Decision } from '../src/types.ts'

const dirs: string[] = []
const stores: Array<AuditStore | HistoryStore> = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pi-guard-hist-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (stores.length) {
    const s = stores.pop()!
    if (s instanceof HistoryStore) s.close()
    else s.close()
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function llmAllow(risk: 'low' | 'medium' | 'high' = 'low'): Decision {
  return { kind: 'allow', source: 'llm', risk, reason: 'ok' }
}

function seed(dbPath: string, commands: Array<{ command: string; decision: Decision; recordedAt?: string }>) {
  const audit = new AuditStore(dbPath)
  stores.push(audit)
  for (const item of commands) {
    audit.insert({
      source: 'tool_call',
      tool: 'bash',
      command: item.command,
      decision: item.decision,
      finalAction: item.decision.kind === 'allow' ? 'allow' : 'block',
      recordedAt: item.recordedAt,
    })
  }
}

describe('HistoryStore', () => {
  it('allows a skeleton with enough low-risk allow history', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    seed(dbPath, [
      { command: 'grep foo a.txt', decision: llmAllow() },
      { command: 'grep bar b.txt', decision: llmAllow() },
      { command: 'grep baz c.txt', decision: llmAllow() },
      { command: 'grep qux d.txt', decision: llmAllow() },
    ])
    const store = new HistoryStore({ dbPath, days: 60 })
    stores.push(store)
    const d = store.decide('grep hello e.txt', 4, 1)
    expect(d).toMatchObject({ kind: 'allow', source: 'history', risk: 'low' })
  })

  it('does not allow when total is below the threshold', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    seed(dbPath, [
      { command: 'grep foo a.txt', decision: llmAllow() },
      { command: 'grep bar b.txt', decision: llmAllow() },
      { command: 'grep baz c.txt', decision: llmAllow() },
    ])
    const store = new HistoryStore({ dbPath, days: 60 })
    stores.push(store)
    expect(store.decide('grep hello e.txt', 4, 1)).toBeUndefined()
  })

  it('does not allow when a real deny exists for the same skeleton', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    seed(dbPath, [
      { command: 'grep foo a.txt', decision: llmAllow() },
      { command: 'grep bar b.txt', decision: llmAllow() },
      { command: 'grep baz c.txt', decision: llmAllow() },
      { command: 'grep qux d.txt', decision: llmAllow() },
      { command: 'grep bad e.txt', decision: { kind: 'deny', source: 'llm', risk: 'low', reason: 'no' } },
    ])
    const store = new HistoryStore({ dbPath, days: 60 })
    stores.push(store)
    expect(store.decide('grep hello f.txt', 4, 1)).toBeUndefined()
  })

  it('ignores risk=null rows', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    seed(dbPath, [
      { command: 'grep foo a.txt', decision: { kind: 'allow', source: 'llm', reason: 'no risk' } },
      { command: 'grep bar b.txt', decision: { kind: 'allow', source: 'llm', reason: 'no risk' } },
      { command: 'grep baz c.txt', decision: { kind: 'allow', source: 'llm', reason: 'no risk' } },
      { command: 'grep qux d.txt', decision: { kind: 'allow', source: 'llm', reason: 'no risk' } },
    ])
    const store = new HistoryStore({ dbPath, days: 60 })
    stores.push(store)
    expect(store.decide('grep hello e.txt', 4, 1)).toBeUndefined()
  })
})
