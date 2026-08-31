import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiskSessionCache, createPendingSinks, createTrackerStore, deletePendingAsk, listPendingAsks, pruneSessions, readPendingAsks, upsertPendingAsk, type PendingAskRecord } from '../src/session-store.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { PersistableMap } from '../src/persist-map.ts'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ag-session-'))
}

function entry(decision: 'allow' | 'deny') {
  const t = Date.now()
  return { decision, risk: 'low' as const, cachedAt: t, expiresAt: t + 60_000 }
}

describe('DiskSessionCache', () => {
  it('persists entries across instances (one process per tool call)', () => {
    const dir = join(tempRoot(), 'abc')
    mkdirSync(dir, { recursive: true })
    new DiskSessionCache(dir).set('sess|ws|cmd', entry('allow'))
    expect(new DiskSessionCache(dir).get('sess|ws|cmd')?.decision).toBe('allow')
  })

  it('drops expired entries at load time (TTL must survive restarts)', () => {
    const dir = join(tempRoot(), 'ttl')
    mkdirSync(dir, { recursive: true })
    writeFileSync(dir + '/cache.json', JSON.stringify({ k: { ...entry('deny'), expiresAt: Date.now() - 1000 } }))
    const cache = new DiskSessionCache(dir)
    expect(cache.get('k')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('trims to maxSize LRU style and supports clear/clearSession', () => {
    const dir = join(tempRoot(), 'lru')
    mkdirSync(dir, { recursive: true })
    const cache = new DiskSessionCache(dir, 2)
    cache.set('a', entry('allow'))
    cache.set('b', entry('allow'))
    cache.set('c', entry('allow'))
    expect(cache.size).toBe(2)
    expect(cache.has('a')).toBe(false)

    const persistent = new DiskSessionCache(dir, 2)
    persistent.clearSession('whatever')
    expect(persistent.size).toBe(0)
    expect(persistent.has('b')).toBe(false)
  })
})

describe('createTrackerStore across processes', () => {
  it('lets a fresh FileTracker detect a previous process write-then-execute', () => {
    const dir = join(tempRoot(), 'tracker')
    mkdirSync(dir, { recursive: true })
    // Process A writes deploy.sh.
    new FileTracker(5000, createTrackerStore(dir, 5000)).evaluate('echo x > deploy.sh')
    // Process B executes it within the window.
    const hit = new FileTracker(5000, createTrackerStore(dir, 5000)).evaluate('bash deploy.sh')
    expect(hit?.scriptPath).toBe('deploy.sh')
    expect(hit?.sameCommand).toBe(false)
  })
})

describe('pending state persistence', () => {
  it('directory-delete first denial survives a process restart via sinks', () => {
    const dir = join(tempRoot(), 'pending')
    mkdirSync(dir, { recursive: true })
    const sinks = createPendingSinks(dir)

    const firstProcess = new PersistableMap<{ deniedAt: number }>(sinks.directoryDeletes)
    firstProcess.set('rm -rf build', { deniedAt: Date.now() })

    const secondProcess = new PersistableMap<{ deniedAt: number }>(sinks.directoryDeletes)
    expect(secondProcess.has('rm -rf build')).toBe(true)
  })
})

describe('pruneSessions', () => {
  it('is safe against a missing sessions root', () => {
    expect(() => pruneSessions(tempRoot(), 0)).not.toThrow()
  })
})

describe('pending asks (ADR-0019)', () => {
  function record(key: string, askedAt: number, overrides: Partial<PendingAskRecord> = {}): PendingAskRecord {
    return { key, command: `cmd ${key}`, risk: 'medium', reason: '需要确认', workspace: '/ws', askedAt, ...overrides }
  }

  it('upserts by key — a repeat ask refreshes the single entry in place', () => {
    const dir = join(tempRoot(), 's1')
    upsertPendingAsk(dir, record('k1', 1000))
    upsertPendingAsk(dir, record('k1', 2000, { risk: 'high' }))
    const all = readPendingAsks(dir)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ key: 'k1', askedAt: 2000, risk: 'high' })
  })

  it('reads oldest first across many entries and tolerates a corrupt file', () => {
    const dir = join(tempRoot(), 's2')
    upsertPendingAsk(dir, record('later', 3000))
    upsertPendingAsk(dir, record('earlier', 1000))
    upsertPendingAsk(dir, record('middle', 2000))
    expect(readPendingAsks(dir).map((entry) => entry.key)).toEqual(['earlier', 'middle', 'later'])
    writeFileSync(join(dir, 'pending-asks.json'), 'not json at all')
    expect(readPendingAsks(dir)).toEqual([])
  })

  it('deletes a resolved entry and reports stale keys', () => {
    const dir = join(tempRoot(), 's3')
    upsertPendingAsk(dir, record('k', 1000))
    expect(deletePendingAsk(dir, 'k')).toBe(true)
    expect(deletePendingAsk(dir, 'k')).toBe(false)
    expect(readPendingAsks(dir)).toEqual([])
  })

  it('lists across session directories oldest first and survives a missing root', () => {
    const root = tempRoot()
    upsertPendingAsk(join(root, 'aaa'), record('second', 2000))
    upsertPendingAsk(join(root, 'bbb'), record('first', 1000))
    const listed = listPendingAsks(root)
    expect(listed.map((entry) => entry.dirName)).toEqual(['bbb', 'aaa'])
    expect(listed[0].record.key).toBe('first')
    expect(listPendingAsks(join(root, 'missing'))).toEqual([])
  })
})
