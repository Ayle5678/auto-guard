import { describe, expect, it } from 'vitest'
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
