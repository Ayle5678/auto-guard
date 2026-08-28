/**
 * Disk-backed template cache for learned `cacheable` rules.
 *
 * When an LLM allows a command matching a learned cacheable pattern, the allow
 * decision is stored under that command's skeleton. Later variants with the
 * same structure (e.g. `--days 7` vs `--days 8`) can hit the template without
 * another LLM call.
 *
 * The ZCode hook model starts one process per tool call, so the pi-era
 * in-memory map could never survive a decision — persistence is what makes
 * the learned layer reachable at all. Entries are only written through
 * `set()`, which refuses commands matching no learned pattern, so the file
 * only ever contains LLM-approved skeletons with a learned-rule backing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { matchRule } from './rules.ts'
import { skeletonOf } from './skeleton.ts'
import type { CacheEntry } from './cache.ts'
import type { PatternRule } from './types.ts'

interface TemplateCacheData {
  version: 1
  entries: Record<string, CacheEntry>
}

export class TemplateCache {
  private readonly entries = new Map<string, CacheEntry>()
  private patterns: PatternRule[] = []
  private readonly path?: string

  constructor(path?: string) {
    this.path = path
    this.load()
  }

  private load(): void {
    if (!this.path) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TemplateCacheData>
      if (!parsed || typeof parsed !== 'object' || !parsed.entries) return
      for (const [skeleton, entry] of Object.entries(parsed.entries)) {
        if (entry && typeof entry === 'object' && typeof entry.expiresAt === 'number') {
          this.entries.set(skeleton, entry)
        }
      }
    } catch {
      // Missing or corrupt file — start empty; the next LLM allow repopulates it.
    }
  }

  private save(): void {
    if (!this.path) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const live: Record<string, CacheEntry> = {}
      const now = Date.now()
      for (const [skeleton, entry] of this.entries) {
        if (entry.expiresAt > now) live[skeleton] = entry
      }
      const data: TemplateCacheData = { version: 1, entries: live }
      writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' })
    } catch {
      // Cache persistence is best-effort; a failed write only costs a re-review.
    }
  }

  setCacheablePatterns(patterns: PatternRule[]): void {
    this.patterns = patterns
  }

  private matchingPattern(command: string): PatternRule | undefined {
    if (this.patterns.length === 0) return undefined
    return matchRule(command, this.patterns)
  }

  get(command: string): CacheEntry | undefined {
    const pattern = this.matchingPattern(command)
    if (!pattern) return undefined
    const key = skeletonOf(command)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  set(command: string, entry: CacheEntry): void {
    const pattern = this.matchingPattern(command)
    if (!pattern) return
    this.entries.set(skeletonOf(command), entry)
    this.save()
  }

  clear(): void {
    this.entries.clear()
    this.save()
  }

  get size(): number {
    return this.entries.size
  }
}
