/**
 * Session-scoped LRU cache and workspace-isolated persistent TTL cache.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RiskLevel } from './types.ts'

export interface AllowDenyDecision {
  kind: 'allow' | 'deny'
  risk?: RiskLevel
  reason?: string
}

export interface CacheEntry {
  decision: 'allow' | 'deny'
  risk?: RiskLevel
  reason?: string
  cachedAt: number
  expiresAt: number
  /** Last hit time, maintained by the persistent cache so eviction is LRU, not FIFO. */
  lastHitAt?: number
}

function now(): number {
  return Date.now()
}

/** Default capacity of the persistent cache; override via the `persistentCacheSize` config key. */
export const DEFAULT_PERSISTENT_CACHE_SIZE = 1000

/**
 * Structural surface the guard service needs from a session cache.
 * `SessionLruCache` is the in-memory implementation; the hook model swaps in
 * a disk-backed one so decisions survive the one-process-per-call lifecycle.
 */
export interface SessionCacheLike {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
  has(key: string): boolean
  delete(key: string): void
  clearSession(session: string): void
  clear(): void
  readonly size: number
}

/** In-memory LRU keyed by `session|workspace|commandShape`. */
export class SessionLruCache implements SessionCacheLike {
  private readonly map = new Map<string, CacheEntry>()
  private readonly maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now()) {
      this.map.delete(key)
      return undefined
    }
    // Re-insert to mark as most recently used.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(key: string, entry: CacheEntry): void {
    this.map.delete(key)
    this.map.set(key, entry)
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  /** Drop one key (used to avoid caching high-risk/always-review commands). */
  delete(key: string): void {
    this.map.delete(key)
  }

  /** Drop every entry belonging to one session. */
  clearSession(session: string): void {
    const prefix = `${session}|`
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) this.map.delete(key)
    }
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}

export interface PersistentCacheData {
  version: 1
  entries: Record<string, CacheEntry>
}

/**
 * Workspace-isolated persistent cache stored in a JSON file under the user
 * home. Includes TTL expiry, LRU eviction at `maxEntries`, and pruning of
 * stale entries. One entry per workspace×command key: re-set and re-hit
 * refresh the existing entry (renewed TTL / recency), never stack duplicates.
 */
export class PersistentCache {
  private entries: Record<string, CacheEntry>
  private readonly dirty = new Set<string>()
  private readonly path: string
  private readonly maxEntries: number

  constructor(path: string, maxEntries = DEFAULT_PERSISTENT_CACHE_SIZE) {
    this.path = path
    this.maxEntries = maxEntries
    this.entries = this.read()
  }

  private read(): Record<string, CacheEntry> {
    try {
      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistentCacheData>
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
        throw new Error('invalid cache shape')
      }
      return (parsed?.entries ?? {}) as Record<string, CacheEntry>
    } catch {
      return {}
    }
  }

  /** Load entries and drop expired ones, saving only when something changed. */
  prune(): number {
    const before = Object.keys(this.entries).length
    const t = now()
    let changed = false
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.expiresAt <= t) {
        delete this.entries[key]
        this.dirty.add(key)
        changed = true
      }
    }
    if (changed) this.save()
    return before - Object.keys(this.entries).length
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries[key]
    if (!entry) return undefined
    if (entry.expiresAt <= now()) {
      delete this.entries[key]
      this.dirty.add(key)
      return undefined
    }
    this.touch(entry, key)
    return entry
  }

  /**
   * Refresh hit recency and persist it immediately: hook hosts run one process
   * per call, so a refresh that isn't written through here is lost on exit and
   * LRU eviction would degrade to FIFO.
   */
  private touch(entry: CacheEntry, key: string): void {
    entry.lastHitAt = now()
    this.dirty.add(key)
    this.save()
  }

  set(key: string, entry: CacheEntry): void {
    this.entries[key] = entry
    this.dirty.add(key)
    this.evictBeyondLimit()
  }

  /** One entry per key already holds duplicates down; overflow evicts the least recently used. */
  private evictBeyondLimit(): void {
    const overflow = Object.keys(this.entries).length - this.maxEntries
    if (overflow <= 0) return
    const oldestFirst = Object.entries(this.entries)
      .map(([key, entry]) => ({ key, at: entry.lastHitAt ?? entry.cachedAt }))
      .sort((a, b) => a.at - b.at)
    for (let i = 0; i < overflow && i < oldestFirst.length; i++) {
      delete this.entries[oldestFirst[i].key]
      this.dirty.add(oldestFirst[i].key)
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  clear(): void {
    this.entries = {}
    this.save()
  }

  save(): void {
    if (this.dirty.size === 0) return
    const t = now()
    const live: Record<string, CacheEntry> = {}
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.expiresAt > t) live[key] = entry
    }
    this.entries = live
    mkdirSync(dirname(this.path), { recursive: true })
    const data: PersistentCacheData = { version: 1, entries: live }
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' })
    this.dirty.clear()
  }

  get size(): number {
    return Object.keys(this.entries).length
  }
}

export function buildSessionKey(session?: string, workspace?: string, commandShape?: string): string {
  return [session ?? '<no-session>', workspace ?? '<no-workspace>', commandShape ?? '<no-command>'].join('|')
}

export function buildWorkspaceKey(workspace?: string, commandShape?: string): string {
  return [workspace ?? '<no-workspace>', commandShape ?? '<no-command>'].join('|')
}

/** TTL in ms from risk level and configured day counts. */
export function ttlForRisk(risk: RiskLevel | undefined, lowRiskTtlDays: number, mediumRiskTtlDays: number): number {
  const days = risk === 'medium' ? mediumRiskTtlDays : lowRiskTtlDays
  return days * 24 * 60 * 60 * 1000
}

export function entryForDecision(decision: AllowDenyDecision, ttlMs: number): CacheEntry {
  const t = now()
  return {
    decision: decision.kind,
    risk: decision.risk,
    reason: decision.reason,
    cachedAt: t,
    expiresAt: t + ttlMs,
  }
}
