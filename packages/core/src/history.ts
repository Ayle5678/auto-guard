/**
 * Runtime history layer.
 *
 * Reads the tool's own audit log and indexes low-risk allow records by command
 * skeleton. A command whose skeleton has enough repeated low-risk allow history
 * and no real deny history can be allowed without another LLM call.
 */
import { AuditStore } from './audit.ts'
import { skeletonOf } from './skeleton.ts'
import type { Decision } from './types.ts'

interface HistoryEntry {
  total: number
  llm: number
  denies: number
}

export interface HistoryStoreOptions {
  dbPath: string
  password?: string
  days?: number
}

export class HistoryStore {
  private readonly audit: AuditStore
  private readonly days: number
  private index = new Map<string, HistoryEntry>()
  private lastRefresh = 0

  constructor(options: HistoryStoreOptions) {
    this.audit = new AuditStore(options.dbPath, options.password)
    this.days = options.days ?? 60
    this.refresh()
  }

  refresh(): void {
    const cutoff = new Date(Date.now() - this.days * 24 * 60 * 60 * 1000).toISOString()
    const next = new Map<string, HistoryEntry>()
    for (const row of this.audit.list()) {
      if (row.recorded_at < cutoff) continue
      if (row.command_normalized.includes('$(') || row.command_normalized.includes('`') || /[<>]/.test(row.command_normalized)) continue
      const skeleton = skeletonOf(row.command_normalized)
      const entry = next.get(skeleton) ?? { total: 0, llm: 0, denies: 0 }
      const realDeny = (row.decision_kind === 'deny' || row.final_action === 'block') && row.reviewer_failed === 0
      if (realDeny) {
        entry.denies++
      } else if (row.decision_kind === 'allow' && row.final_action === 'allow' && row.risk === 'low') {
        entry.total++
        if (row.decision_source === 'llm' && row.reviewer_failed === 0) entry.llm++
      }
      next.set(skeleton, entry)
    }
    this.index = next
    this.lastRefresh = Date.now()
  }

  private refreshIfStale(): void {
    if (Date.now() - this.lastRefresh > 60_000) this.refresh()
  }

  decide(command: string, minTotal: number, minLlm: number): Decision | undefined {
    this.refreshIfStale()
    const skeleton = skeletonOf(command)
    const entry = this.index.get(skeleton)
    if (!entry) return undefined
    if (entry.denies > 0) return undefined
    if (entry.total < minTotal || entry.llm < minLlm) return undefined
    return {
      kind: 'allow',
      source: 'history',
      risk: 'low',
      category: 'cacheable',
      reason: `Matched ${entry.total} historical low-risk allows (${entry.llm} LLM)`,
    }
  }

  close(): void {
    this.audit.close()
  }
}
