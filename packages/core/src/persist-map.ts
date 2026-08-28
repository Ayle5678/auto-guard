/**
 * A Map with a minimal surface (get/set/has/delete/keys/clear/size) whose
 * mutations can optionally be mirrored to a JSON persistence sink.
 *
 * Exists because the hook model runs one process per tool call: any state the
 * guard keeps in memory dies with the process. The guard's pending
 * directory-delete reviews and pending denies must survive across invocations
 * within a session, so a persistence-backed variant is injected there while
 * tests keep using plain in-memory instances.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Read/write one JSON file storing `{ [key]: value }`. */
export interface JsonSink {
  read(): Record<string, unknown>
  write(data: Record<string, unknown>): void
}

/** A JSON-file sink under `<path>`, best-effort against I/O errors. */
export class FileJsonSink implements JsonSink {
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  read(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  write(data: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, `${JSON.stringify(data)}\n`, { encoding: 'utf8' })
    } catch {
      // Best-effort: losing pending state degrades to re-review, never worse.
    }
  }
}

/** Read-only view sink over a static object (tests / dry runs). */
export function memorySink(data: Record<string, unknown> = {}): JsonSink {
  return {
    read: () => data,
    write: (next) => {
      for (const key of Object.keys(data)) delete data[key]
      Object.assign(data, next)
    },
  }
}

export class PersistableMap<T> {
  private readonly map = new Map<string, T>()
  private readonly sink?: JsonSink

  constructor(sink?: JsonSink) {
    this.sink = sink
    if (this.sink) this.hydrate()
  }

  private hydrate(): void {
    if (!this.sink) return
    for (const [key, value] of Object.entries(this.sink.read())) {
      this.map.set(key, value as T)
    }
  }

  private flush(): void {
    if (!this.sink) return
    const data: Record<string, unknown> = {}
    for (const [key, value] of this.map) data[key] = value
    this.sink.write(data)
  }

  get(key: string): T | undefined {
    return this.map.get(key)
  }

  set(key: string, value: T): void {
    this.map.set(key, value)
    this.flush()
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  delete(key: string): boolean {
    const removed = this.map.delete(key)
    if (removed) this.flush()
    return removed
  }

  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  clear(): void {
    this.map.clear()
    this.flush()
  }

  get size(): number {
    return this.map.size
  }
}
