import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditStore } from '../src/audit.ts'
import { PersistentCache, SessionLruCache } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { HistoryStore } from '../src/history.ts'
import { loadRules } from '../src/rules.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'
import type { GuardConfig, GuardRequest, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return { decision: 'allow', risk: 'low', reason: 'ok' }
  }
}

function makeConfig(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return {
    enabled: true,
    rulesPath: '~/.pi/auto-guard/rules.json',
    defaultRulesPath: '~/.pi/auto-guard/defaults.json',
    cachePath: '~/.pi/auto-guard/cache.json',
    apiBase: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: '',
    model: 'deepseek-v4-flash',
    fallbackModel: 'deepseek-v4-flash',
    timeoutMs: 100,
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    onTimeout: 'deny',
    headlessMode: 'deny',
    notifyCacheHit: true,
    notifyLlmDecision: true,
    notifyAllow: 'page',
    notifyDeny: 'context',
    notifyAsk: 'context',
    fileTrackerDefault: 'ask',
    fileTrackerWindowSec: 5,
    sessionCacheSize: 16,
    alwaysReviewCacheTtlMinutes: 30,
    examineEnabled: true,
    auditDbPath: '~/.pi/auto-guard/audit.db',
    historyEnabled: true,
    autoAnalyzeEnabled: false,
    historyDays: 60,
    historyMinTotal: 4,
    historyMinLlm: 1,
    learnedCacheableMinTotal: 8,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    templateCachePath: "template-cache.json",
    learnedRulesPath: '~/.pi/auto-guard/learned-rules.json',
    learnedBackupPath: '~/.pi/auto-guard/learned-rules.backup.json',
    analyzeStatePath: '~/.pi/auto-guard/analyze-state.json',
    ...overrides,
  }
}

function shell(command: string): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace: '/workspace/a' }
}

describe('GuardService: history layer', () => {
  it('serves a history hit before LLM and writes session cache', async () => {
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

      const config = makeConfig()
      config.rulesPath = join(dir, 'rules.json')
      config.defaultRulesPath = join(dir, 'defaults.json')
      config.cachePath = join(dir, 'cache.json')
      config.auditDbPath = dbPath
      const sessionCache = new SessionLruCache(config.sessionCacheSize)
      const persistentCache = new PersistentCache(config.cachePath)
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
      const history = new HistoryStore({ dbPath, days: 60 })
      const service = new GuardService({
        config,
        rules: loadRules(config.rulesPath, config.defaultRulesPath),
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

      const second = await service.decide(shell('grep hello e.txt'))
      expect(second).toMatchObject({ kind: 'allow', source: 'session-cache', cached: true })
      expect(service.stats.historyHits).toBe(1)
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

      const config = makeConfig({ historyEnabled: false })
      config.rulesPath = join(dir, 'rules.json')
      config.defaultRulesPath = join(dir, 'defaults.json')
      config.cachePath = join(dir, 'cache.json')
      config.auditDbPath = dbPath
      const sessionCache = new SessionLruCache(config.sessionCacheSize)
      const persistentCache = new PersistentCache(config.cachePath)
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
      const history = new HistoryStore({ dbPath, days: 60 })
      const service = new GuardService({
        config,
        rules: loadRules(config.rulesPath, config.defaultRulesPath),
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
