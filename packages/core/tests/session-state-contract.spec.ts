/**
 * Interface contract tests shared by the in-memory session-state
 * implementations and the disk-backed ones (ADR-0004).
 *
 * Hosts pick an implementation at bootstrap by swapping one factory; these
 * tests pin the contract both must satisfy so the choice stays invisible to
 * GuardService.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLruCache } from '../src/cache.ts'
import { DiskSessionCache, createPendingSinks, createTrackerStore } from '../src/session-store.ts'
import { FileJsonSink, memorySink } from '../src/persist-map.ts'
import { FileTracker } from '../src/file-tracker.ts'
import type { CacheEntry, SessionCacheLike } from '../src/cache.ts'
import type { JsonSink } from '../src/persist-map.ts'

const dirs: string[] = []
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-contract-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function entry(decision: 'allow' | 'deny', ttlMs = 60_000): CacheEntry {
  const t = Date.now()
  return { decision, risk: 'low' as const, cachedAt: t, expiresAt: t + ttlMs }
}

function sessionCaches(): Array<{ name: string; make: () => SessionCacheLike; dir?: string }> {
  return [
    { name: 'SessionLruCache (memory)', make: () => new SessionLruCache(4) },
    {
      name: 'DiskSessionCache (disk)',
      make: () => {
        const dir = join(tmpDir(), 'sess')
        mkdirSync(dir, { recursive: true })
        return new DiskSessionCache(dir, 4)
      },
    },
  ]
}

describe.each(sessionCaches())('session cache contract: $name', ({ make }) => {
  it('set then get returns the entry', () => {
    const cache = make()
    cache.set('s|w|cmd', entry('allow'))
    expect(cache.get('s|w|cmd')?.decision).toBe('allow')
    expect(cache.has('s|w|cmd')).toBe(true)
  })

  it('returns undefined and evicts expired entries', () => {
    const cache = make()
    cache.set('s|w|cmd', entry('allow', -1))
    expect(cache.get('s|w|cmd')).toBeUndefined()
    expect(cache.has('s|w|cmd')).toBe(false)
  })

  it('evicts the oldest entry beyond maxSize (LRU)', () => {
    const cache = make()
    cache.set('k1', entry('allow'))
    cache.set('k2', entry('allow'))
    cache.set('k3', entry('allow'))
    cache.set('k4', entry('allow'))
    cache.set('k5', entry('allow'))
    expect(cache.has('k1')).toBe(false)
    expect(cache.has('k5')).toBe(true)
    expect(cache.size).toBe(4)
  })

  it('delete removes a single entry; clear removes all', () => {
    const cache = make()
    cache.set('k1', entry('allow'))
    cache.set('k2', entry('allow'))
    cache.delete('k1')
    expect(cache.has('k1')).toBe(false)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('tracker store contract', () => {
  it('FileTracker works unchanged over memory and disk stores', () => {
    const windowMs = 5000
    const diskDir = join(tmpDir(), 'tracker')
    mkdirSync(diskDir, { recursive: true })
    const stores: Array<{ name: string; store: Record<string, unknown> }> = [
      { name: 'memory', store: new Map<string, number>() },
      { name: 'disk', store: createTrackerStore(diskDir, windowMs) },
    ]
    for (const { name, store } of stores) {
      const tracker = new FileTracker(windowMs, store as never)
      const write = tracker.evaluate('echo x > /tmp/x.sh')
      expect(write ?? undefined, name).toBeUndefined()
      const hit = tracker.evaluate('bash /tmp/x.sh')
      expect(hit, name).toBeDefined()
      expect(hit?.scriptPath, name).toBe('/tmp/x.sh')
    }
  })
})

describe('pending sinks contract', () => {
  it('memory sink and disk-backed pending sinks expose the same JsonSink surface', () => {
    const diskDir = join(tmpDir(), 'sinks')
    mkdirSync(diskDir, { recursive: true })
    const sinks: Array<{ name: string; sink: JsonSink }> = [
      { name: 'memorySink', sink: memorySink() },
      { name: 'FileJsonSink', sink: new FileJsonSink(join(diskDir, 'pending.json')) },
    ]
    for (const { name, sink } of sinks) {
      sink.write({ a: 1 })
      expect(sink.read(), name).toEqual({ a: 1 })
      const sinks2 = createPendingSinks(diskDir)
      expect(sinks2.directoryDeletes.read(), name).toEqual({})
      expect(typeof sinks2.denies.read, name).toBe('function')
    }
  })
})
