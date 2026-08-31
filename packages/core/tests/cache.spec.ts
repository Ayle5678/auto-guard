import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSessionKey, buildWorkspaceKey, entryForDecision, PersistentCache, SessionLruCache, ttlForRisk } from '../src/cache.ts'

const base = { cachedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } as const

describe('SessionLruCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new SessionLruCache(10)
    cache.set('a', { ...base, decision: 'allow', reason: 'ok' })
    expect(cache.get('a')?.reason).toBe('ok')
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts least recently used entries beyond capacity', () => {
    const cache = new SessionLruCache(2)
    cache.set('a', { ...base, decision: 'allow' })
    cache.set('b', { ...base, decision: 'allow' })
    cache.get('a') // a becomes most recent
    cache.set('c', { ...base, decision: 'allow' })
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('clears all entries', () => {
    const cache = new SessionLruCache(10)
    cache.set('a', { ...base, decision: 'allow' })
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('clears only the entries for one session', () => {
    const cache = new SessionLruCache(10)
    cache.set('s1|w1|cmd', { ...base, decision: 'allow' })
    cache.set('s1|w2|cmd', { ...base, decision: 'allow' })
    cache.set('s2|w1|cmd', { ...base, decision: 'allow' })
    cache.clearSession('s1')
    expect(cache.get('s1|w1|cmd')).toBeUndefined()
    expect(cache.get('s1|w2|cmd')).toBeUndefined()
    expect(cache.get('s2|w1|cmd')).toBeDefined()
  })

  it('gives every session its own full capacity so concurrent sessions never evict each other', () => {
    const cache = new SessionLruCache(2)
    for (const cmd of ['a', 'b']) cache.set(`s1|w|${cmd}`, { ...base, decision: 'allow' })
    for (const cmd of ['a', 'b']) cache.set(`s2|w|${cmd}`, { ...base, decision: 'allow' })
    // A shared LRU of 2 would have evicted s1's entries by now.
    expect(cache.get('s1|w|a')).toBeDefined()
    expect(cache.get('s1|w|b')).toBeDefined()
    expect(cache.get('s2|w|a')).toBeDefined()
    expect(cache.get('s2|w|b')).toBeDefined()
    // Each partition still evicts within itself.
    cache.set('s1|w|c', { ...base, decision: 'allow' })
    expect(cache.get('s1|w|a')).toBeUndefined()
    expect(cache.get('s2|w|a')).toBeDefined()
  })

  it('drops a whole session partition after a day without new writes', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const cache = new SessionLruCache(10)
      cache.set('s1|w|cmd', { ...base, decision: 'allow' })
      cache.set('s2|w|cmd', { ...base, decision: 'allow' })

      // > 24h with no new writes in s1; s2 wrote again inside the window.
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
      cache.set('s2|w|cmd2', { ...base, decision: 'allow' })
      vi.setSystemTime(new Date('2026-01-02T00:01:00Z'))

      expect(cache.get('s1|w|cmd')).toBeUndefined()
      expect(cache.get('s2|w|cmd')).toBeDefined()
      expect(cache.has('s1|w|cmd')).toBe(false)
      expect(cache.size).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a write refreshes the idle clock but a hit does not', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const cache = new SessionLruCache(10)
      cache.set('s1|w|cmd', { ...base, decision: 'allow' })
      cache.set('s2|w|cmd', { ...base, decision: 'allow' })

      // 23h in: a write in s1 refreshes its clock, s2 only gets cache hits.
      vi.setSystemTime(new Date('2026-01-01T23:00:00Z'))
      cache.set('s1|w|cmd2', { ...base, decision: 'allow' })
      expect(cache.get('s2|w|cmd')).toBeDefined()

      // 25h after the original writes: s1 survived (fresh write 2h ago), s2 did not.
      vi.setSystemTime(new Date('2026-01-02T01:00:00Z'))
      expect(cache.get('s1|w|cmd')).toBeDefined()
      expect(cache.get('s2|w|cmd')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not return expired entries and deletes them on read', () => {
    const cache = new SessionLruCache(10)
    cache.set('old', { decision: 'allow', cachedAt: 0, expiresAt: 1 })
    expect(cache.get('old')).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(cache.has('old')).toBe(false)
  })

  it('builds keys including session and workspace', () => {
    expect(buildSessionKey('s1', 'w1', 'npm install')).toBe('s1|w1|npm install')
    expect(buildWorkspaceKey('w1', 'npm install')).toBe('w1|npm install')
  })
})

describe('PersistentCache', () => {
  it('persists entries with workspace isolation and reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-cache-'))
    try {
      const path = join(dir, 'cache.json')
      const cacheA = new PersistentCache(path)
      cacheA.set('w1|npm install', { ...base, decision: 'allow', reason: 'approved once', risk: 'low' })
      cacheA.save()

      const cacheB = new PersistentCache(path)
      expect(cacheB.get('w1|npm install')?.reason).toBe('approved once')
      // Different workspace does not share the entry.
      expect(cacheB.get('w2|npm install')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not hit expired entries and prunes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-cache-'))
    try {
      const path = join(dir, 'cache.json')
      const cache = new PersistentCache(path)
      const expired = { decision: 'allow' as const, cachedAt: 0, expiresAt: 1 }
      cache.set('w|old', expired)
      expect(cache.prune()).toBe(1)
      expect(cache.size).toBe(0)
      expect(cache.get('w|old')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges identical commands: re-set refreshes the single entry instead of stacking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-cache-'))
    try {
      const cache = new PersistentCache(join(dir, 'cache.json'))
      cache.set('w|npm test', { decision: 'allow', reason: 'first', cachedAt: 1, expiresAt: Number.MAX_SAFE_INTEGER })
      cache.set('w|npm test', { decision: 'allow', reason: 'second', cachedAt: 2, expiresAt: Number.MAX_SAFE_INTEGER })
      expect(cache.size).toBe(1)
      expect(cache.get('w|npm test')?.reason).toBe('second')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('computes TTL by risk level', () => {
    expect(ttlForRisk('low', 30, 7)).toBe(30 * 24 * 60 * 60 * 1000)
    expect(ttlForRisk('medium', 30, 7)).toBe(7 * 24 * 60 * 60 * 1000)
    expect(ttlForRisk(undefined, 30, 7)).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('builds cache entries with cachedAt and expiresAt', () => {
    const entry = entryForDecision({ kind: 'allow', reason: 'r' }, 1000)
    expect(entry.decision).toBe('allow')
    expect(entry.expiresAt).toBeGreaterThan(entry.cachedAt)
  })
})
