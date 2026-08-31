/**
 * Disk-backed session-scoped state for one-process-per-call host models.
 *
 * A PreToolUse hook runs one fresh process per tool call, so anything the
 * guard used to keep in memory (session cache, file-tracker write history,
 * pending directory-delete reviews / pending denies) must live on disk and be
 * scoped to a session id supplied by the host adapter.
 *
 * Layout under the session root:
 *   sessions/<sid-hash>/cache.json            — SessionCacheLike entries
 *   sessions/<sid-hash>/tracker.json          — FileTracker write timestamps
 *   sessions/<sid-hash>/pending-deletes.json  — directory-delete first denials
 *   sessions/<sid-hash>/pending-denies.json   — LLM denies awaiting re-ask
 *   sessions/<sid-hash>/pending-asks.json     — asks awaiting a `guard ask` resolution (ADR-0019)
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CacheEntry, SessionCacheLike } from './cache.ts'
import { FileJsonSink, type JsonSink } from './persist-map.ts'

/** Stable, filesystem-safe directory name for a session id. */
export function sidHash(sessionId: string): string {
  return createHash('sha1').update(sessionId).digest('hex').slice(0, 16)
}

function now(): number {
  return Date.now()
}

/** In-memory-shaped sink over one JSON file inside the session directory. */
function sinkFor(dir: string, name: string): JsonSink {
  return new FileJsonSink(join(dir, name))
}

/**
 * `SessionLruCache`-compatible cache persisted to `sessions/<hash>/cache.json`.
 * Writes are flushed on every mutation — entries are small and hook runs are
 * short, so consistency beats write batching.
 */
export class DiskSessionCache implements SessionCacheLike {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly path: string
  private readonly maxSize: number

  constructor(dir: string, maxSize = 300) {
    this.path = join(dir, 'cache.json')
    this.maxSize = maxSize
    this.hydrate()
  }

  private hydrate(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CacheEntry>
      if (!raw || typeof raw !== 'object') return
      const t = now()
      for (const [key, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== 'object' || typeof entry.expiresAt !== 'number') continue
        // Drop long-expired entries at load; get() handles the fresh ones.
        if (entry.expiresAt <= t) continue
        this.entries.set(key, entry)
      }
    } catch {
      return
    }
  }

  private save(): void {
    try {
      mkdirSync(join(this.path, '..'), { recursive: true })
      const data: Record<string, CacheEntry> = {}
      for (const [key, entry] of this.entries) data[key] = entry
      writeFileSync(this.path, `${JSON.stringify(data)}\n`, { encoding: 'utf8' })
    } catch {
      // Losing an in-session cache only costs a repeat review.
    }
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now()) {
      this.entries.delete(key)
      this.save()
      return undefined
    }
    return entry
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.save()
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): void {
    if (this.entries.delete(key)) this.save()
  }

  clearSession(_session: string): void {
    // One DiskSessionCache is bound to exactly one session directory.
    this.clear()
  }

  clear(): void {
    this.entries.clear()
    this.save()
  }

  get size(): number {
    return this.entries.size
  }
}

/** `FileTracker.WriteStore` over `sessions/<hash>/tracker.json`. */
export function createTrackerStore(dir: string, windowMs: number) {
  const sink = sinkFor(dir, 'tracker.json')
  return {
    get(path: string): number | undefined {
      const raw = sink.read()[path]
      const at = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(at)) return undefined
      // Stale writes are irrelevant; treat as absent and let saves prune them.
      if (now() - at > Math.max(windowMs * 20, 60_000)) return undefined
      return at
    },
    set(path: string, at: number): void {
      const data = sink.read()
      data[path] = at
      // Prune stale rows to keep the file tiny.
      const keep = now() - Math.max(windowMs * 20, 60_000)
      for (const key of Object.keys(data)) {
        const v = Number(data[key])
        if (Number.isFinite(v) && v < keep) delete data[key]
      }
      sink.write(data)
    },
  }
}

/** Sinks backing {@link PendingPersistence} for one session directory. */
export interface PendingSinks {
  directoryDeletes: JsonSink
  denies: JsonSink
}

export function createPendingSinks(dir: string): PendingSinks {
  return {
    directoryDeletes: sinkFor(dir, 'pending-deletes.json'),
    denies: sinkFor(dir, 'pending-denies.json'),
  }
}

/**
 * One ask awaiting a `guard ask` resolution (ADR-0019). The hook records it
 * as a pure side note on every ask; the management CLI resolves it into the
 * session cache (the same entry a pi four-state choice would have written).
 */
export interface PendingAskRecord {
  /** Session-cache key the resolved choice must be written under — the guard builds it from the decided command. */
  key: string
  /** The decided command text (shell command, or the file path for file tools). */
  command: string
  risk?: string
  /** The guard's ask reason as shown in the host prompt. */
  reason?: string
  workspace?: string
  askedAt: number
}

const PENDING_ASKS_FILE = 'pending-asks.json'

/** Insert or refresh one pending ask, keyed by its session-cache key. Best-effort like every session file. */
export function upsertPendingAsk(dir: string, record: PendingAskRecord): void {
  const sink = sinkFor(dir, PENDING_ASKS_FILE)
  const data = sink.read()
  data[record.key] = record
  sink.write(data)
}

/** Read one session's pending asks, oldest first; unreadable file yields []. */
export function readPendingAsks(dir: string): PendingAskRecord[] {
  const records: PendingAskRecord[] = []
  for (const value of Object.values(sinkFor(dir, PENDING_ASKS_FILE).read())) {
    const record = value as PendingAskRecord
    if (record && typeof record === 'object' && typeof record.key === 'string' && typeof record.askedAt === 'number') {
      records.push(record)
    }
  }
  return records.sort((a, b) => a.askedAt - b.askedAt)
}

/** Drop a resolved pending ask; false when it was already gone (stale entry). */
export function deletePendingAsk(dir: string, key: string): boolean {
  const sink = sinkFor(dir, PENDING_ASKS_FILE)
  const data = sink.read()
  if (!(key in data)) return false
  delete data[key]
  sink.write(data)
  return true
}

/** Cross-session view for the management CLI: every pending ask with its session directory name, oldest first. */
export function listPendingAsks(root: string): Array<{ dirName: string; record: PendingAskRecord }> {
  const found: Array<{ dirName: string; record: PendingAskRecord }> = []
  try {
    for (const dirName of readdirSync(root)) {
      for (const record of readPendingAsks(join(root, dirName))) {
        found.push({ dirName, record })
      }
    }
  } catch {
    return found
  }
  return found.sort((a, b) => a.record.askedAt - b.record.askedAt)
}

/** Root directory of per-session state, inside the host config root. */
export function sessionsRoot(configRoot: string): string {
  return join(configRoot, 'sessions')
}

/** Directory holding all state for one session id (created on demand). */
export function sessionDir(sessionId: string | undefined, root: string): string {
  const dir = join(root, sidHash(sessionId ?? '<no-session>'))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Per-process singletons resolved once per hook invocation. */
export interface SessionState {
  sessionId?: string
  dir: string
  cache: DiskSessionCache
  sinks: PendingSinks
}

export function loadSessionState(root: string, maxSize?: number, sessionId?: string): SessionState {
  const dir = sessionDir(sessionId, root)
  return {
    sessionId,
    dir,
    cache: new DiskSessionCache(dir, maxSize),
    sinks: createPendingSinks(dir),
  }
}

/** Remove session directories idle for longer than `maxAgeMs`. Best-effort. */
export function pruneSessions(root: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  let removed = 0
  try {
    if (!existsSync(root)) return 0
    const cutoff = now() - maxAgeMs
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      try {
        const mtime = statSync(dir).mtimeMs
        if (mtime < cutoff) {
          rmSync(dir, { recursive: true, force: true })
          removed += 1
        }
      } catch {
        continue
      }
    }
  } catch {
    return removed
  }
  return removed
}

