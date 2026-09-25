import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore as AuditStore } from '../src/audit.ts'
import { PersistentCache, SessionLruCache } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { HistoryStore } from '../src/history.ts'
import { loadRules } from '../src/rules.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return { decision: 'allow', risk: 'low', reason: 'ok' }
  }
}

/** The engine-tuning slice only (SPEC 0019 ticket 04). */
function makeTuning(overrides: Partial<GuardTuning> = {}): GuardTuning {
  return {
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    alwaysReviewCacheTtlMinutes: 30,
    onTimeout: 'deny',
    fileTrackerDefault: 'ask',
    historyEnabled: true,
    examineEnabled: true,
    historyMinTotal: 4,
    historyMinLlm: 1,
    ...overrides,
  }
}

function shell(command: string): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace: '/workspace/a' }
}

describe('GuardService: history layer', () => {
  it('serves every repeat from the history layer without writing session cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-hist-svc-'))
    try {
      const dbPath = join(dir, 'audit.db')
      const audit = new AuditStore(dbPath)
      for (const cmd of ['grep foo a.txt', 'grep bar b.txt', 'grep baz c.txt', 'grep qux d.txt']) {
        audit.insert({
          source: 'tool_call',
          tool: 'bash',
          command: cmd,
          decision: { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' },
          finalAction: 'allow',
        })
      }
      audit.close()

      const sessionCache = new SessionLruCache(16)
      const persistentCache = new PersistentCache(join(dir, 'cache.json'))
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(5 * 1000)
      const history = new HistoryStore({ dbPath, days: 60 })
      const service = new GuardService({
        config: makeTuning(),
        rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
        sessionCache,
        persistentCache,
        llmReviewer: llm,
        fileTracker,
        historyStore: history,
      })

      const first = await service.decide(shell('grep hello e.txt'))
      expect(first).toMatchObject({ kind: 'allow', source: 'history', risk: 'low' })
      expect(service.stats.historyHits).toBe(1)
      expect(llm.calls).toHaveLength(0)
      // Spec 0016: history hits write no cache — slots stay for LLM-reviewed
      // conclusions, and each repeat re-queries the local audit store.
      expect(sessionCache.size).toBe(0)
      expect(persistentCache.size).toBe(0)

      const second = await service.decide(shell('grep hello e.txt'))
      expect(second).toMatchObject({ kind: 'allow', source: 'history', risk: 'low' })
      expect(service.stats.historyHits).toBe(2)
      expect(sessionCache.size).toBe(0)
      expect(llm.calls).toHaveLength(0)

      history.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not use history when the switch is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-hist-svc-'))
    try {
      const dbPath = join(dir, 'audit.db')
      const audit = new AuditStore(dbPath)
      for (const cmd of ['grep foo a.txt', 'grep bar b.txt', 'grep baz c.txt', 'grep qux d.txt']) {
        audit.insert({
          source: 'tool_call',
          tool: 'bash',
          command: cmd,
          decision: { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' },
          finalAction: 'allow',
        })
      }
      audit.close()

      const sessionCache = new SessionLruCache(16)
      const persistentCache = new PersistentCache(join(dir, 'cache.json'))
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(5 * 1000)
      const history = new HistoryStore({ dbPath, days: 60 })
      const service = new GuardService({
        config: makeTuning({ historyEnabled: false }),
        rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
        sessionCache,
        persistentCache,
        llmReviewer: llm,
        fileTracker,
        historyStore: history,
      })

      const d = await service.decide(shell('grep hello e.txt'))
      expect(d.source).toBe('llm')
      expect(llm.calls).toHaveLength(1)
      history.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
