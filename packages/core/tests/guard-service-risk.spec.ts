import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentCache, SessionLruCache } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { loadRules } from '../src/rules.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'
import type { GuardConfig, GuardRequest, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  constructor(private readonly result: LlmReviewResult) {}
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return this.result
  }
}

function makeConfig(): GuardConfig {
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
    examineEnabled: false,
    auditDbPath: '~/.pi/auto-guard/audit.db',
    historyEnabled: false,
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
  }
}

function setup(llmResult: LlmReviewResult) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-guard-risk-'))
  const config = makeConfig()
  config.rulesPath = join(dir, 'rules.json')
  config.defaultRulesPath = join(dir, 'defaults.json')
  config.cachePath = join(dir, 'cache.json')
  const sessionCache = new SessionLruCache(config.sessionCacheSize)
  const persistentCache = new PersistentCache(config.cachePath)
  const llm = new StubReviewer(llmResult)
  const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
  const service = new GuardService({
    config,
    rules: loadRules(config.rulesPath, config.defaultRulesPath),
    sessionCache,
    persistentCache,
    llmReviewer: llm,
    fileTracker,
  })
  return { service, llm, dir }
}

function shell(command: string): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace: '/workspace/a' }
}

describe('GuardService: risk backfill for compound/pipeline final decisions', () => {
  it('backfills low risk on a compound whose unmatched segment was LLM-allowed as low', async () => {
    const { service, dir } = setup({ decision: 'allow', risk: 'low', reason: 'ok' })
    try {
      const d = await service.decide(shell('ls; npm run build'))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm', risk: 'low' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('backfills low risk on a pipeline assembled from cached low-risk leaves', async () => {
    const { service, dir } = setup({ decision: 'allow', risk: 'low', reason: 'ok' })
    try {
      await service.decide(shell('npm run build'))
      const d = await service.decide(shell('ls | npm run build'))
      expect(d).toMatchObject({ kind: 'allow', source: 'session-cache', risk: 'low' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes the highest risk when a cached leaf is medium', async () => {
    const { service, dir } = setup({ decision: 'allow', risk: 'medium', reason: 'medium' })
    try {
      await service.decide(shell('npm run build'))
      const d = await service.decide(shell('ls | npm run build'))
      expect(d).toMatchObject({ kind: 'allow', source: 'session-cache', risk: 'medium' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
