import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiskSessionCache, createPendingSinks, createTrackerStore, pruneSessions } from '../src/session-store.ts'
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
