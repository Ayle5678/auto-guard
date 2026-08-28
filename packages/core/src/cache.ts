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
}

function now(): number {
  return Date.now()
}

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

  constructor(maxSize = 128) {
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
 * home. Includes TTL expiry and optional pruning of stale entries.
 */
export class PersistentCache {
  private entries: Record<string, CacheEntry>
  private readonly dirty = new Set<string>()
  private readonly path: string

  constructor(path: string) {
    this.path = path
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
    return entry
  }

  set(key: string, entry: CacheEntry): void {
    this.entries[key] = entry
    this.dirty.add(key)
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
