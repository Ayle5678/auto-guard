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

/** A session idle (no new writes) longer than this loses its whole partition — mirrors the disk model's pruneSessions window. */
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000

/** One session's LRU partition plus the freshness clock used for idle eviction. */
interface SessionPartition {
  entries: Map<string, CacheEntry>
  lastWriteAt: number
}

/**
 * In-memory LRU keyed by `session|workspace|commandShape`, partitioned by
 * session: every concurrent session gets its own full `maxSize` budget, so
 * one busy session can never evict another's entries. Hook hosts reach the
 * same guarantees structurally (one DiskSessionCache per session directory,
 * pruned by pruneSessions). A partition untouched by writes for a day is
 * dropped wholesale, so dead sessions cannot accumulate in a long-lived
 * host process.
 */
export class SessionLruCache implements SessionCacheLike {
  private readonly sessions = new Map<string, SessionPartition>()
  private readonly maxSize: number

  constructor(maxSize = 300) {
    this.maxSize = maxSize
  }

  /** The session's own LRU; the leading `|`-separated key segment is the session id. */
  private partitionOf(key: string): SessionPartition {
    const session = sessionSegmentOf(key)
    let partition = this.sessions.get(session)
    if (!partition) {
      partition = { entries: new Map(), lastWriteAt: now() }
      this.sessions.set(session, partition)
    }
    return partition
  }

  /** Drop partitions with no new writes for over a day. Runs on every access; the session count is small. */
  private sweepIdle(): void {
    const t = now()
    for (const [session, partition] of this.sessions) {
      if (t - partition.lastWriteAt > SESSION_IDLE_TTL_MS) this.sessions.delete(session)
    }
  }

  /** Lookup without creating a partition for unknown sessions. */
  private peekPartition(key: string): SessionPartition | undefined {
    return this.sessions.get(sessionSegmentOf(key))
  }

  get(key: string): CacheEntry | undefined {
    this.sweepIdle()
    const session = sessionSegmentOf(key)
    const partition = this.sessions.get(session)
    const entry = partition?.entries.get(key)
    if (!entry || !partition) return undefined
    if (entry.expiresAt <= now()) {
      partition.entries.delete(key)
      if (partition.entries.size === 0) this.sessions.delete(session)
      return undefined
    }
    // Re-insert to mark as most recently used.
    partition.entries.delete(key)
    partition.entries.set(key, entry)
    return entry
  }

  set(key: string, entry: CacheEntry): void {
    this.sweepIdle()
    const partition = this.partitionOf(key)
    partition.lastWriteAt = now()
    partition.entries.delete(key)
    partition.entries.set(key, entry)
    while (partition.entries.size > this.maxSize) {
      const oldest = partition.entries.keys().next().value
      if (oldest === undefined) break
      partition.entries.delete(oldest)
    }
  }

  has(key: string): boolean {
    this.sweepIdle()
    return this.peekPartition(key)?.entries.has(key) ?? false
  }

  /** Drop one key (used to avoid caching high-risk/always-review commands). */
  delete(key: string): void {
    const partition = this.peekPartition(key)
    if (!partition) return
    partition.entries.delete(key)
    if (partition.entries.size === 0) this.sessions.delete(sessionSegmentOf(key))
  }

  /** Drop every entry belonging to one session. */
  clearSession(session: string): void {
    this.sessions.delete(session)
  }

  clear(): void {
    this.sessions.clear()
  }

  get size(): number {
    this.sweepIdle()
    let total = 0
    for (const partition of this.sessions.values()) total += partition.entries.size
    return total
  }
}

/** Leading key segment is the session; keys without one share a single partition (matches the disk implementation's opaque behavior). */
function sessionSegmentOf(key: string): string {
  const end = key.indexOf('|')
  return end >= 0 ? key.slice(0, end) : '<shared>'
}

export interface PersistentCacheData {
  version: 1
  entries: Record<string, CacheEntry>
}

/**
 * Workspace-isolated persistent cache stored in a JSON file under the user
 * home. Includes TTL expiry and pruning of stale entries; there is no entry
 * cap — TTL expiry is the only eviction (30d low / 7d medium, high risk never
 * cached). One entry per workspace×command key: re-set and re-hit refresh the
 * existing entry (renewed TTL), never stack duplicates.
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
