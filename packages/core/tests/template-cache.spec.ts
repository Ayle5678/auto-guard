import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { entryForDecision, PersistentCache, SessionLruCache } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { loadRules } from '../src/rules.ts'
import { TemplateCache } from '../src/template-cache.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'
import type { GuardConfig, GuardRequest, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return { decision: 'allow', risk: 'low', reason: 'ok' }
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
    templateCachePath: 'template-cache.json',
    learnedRulesPath: '~/.pi/auto-guard/learned-rules.json',
    learnedBackupPath: '~/.pi/auto-guard/learned-rules.backup.json',
    analyzeStatePath: '~/.pi/auto-guard/analyze-state.json',
  }
}

function shell(command: string): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace: '/workspace/a' }
}

describe('TemplateCache', () => {
  it('returns an allow for a variant with the same skeleton', () => {
    const cache = new TemplateCache()
    cache.setCacheablePatterns([{ pattern: 'python -m pytest * -q', reason: 'learned' }])
    cache.set('python -m pytest a.py -q', entryForDecision({ kind: 'allow', risk: 'low', reason: 'ok' }, 60_000))
    const hit = cache.get('python -m pytest b.py -q')
    expect(hit).toMatchObject({ decision: 'allow', risk: 'low' })
  })

  it('does not return entries for non-matching commands', () => {
    const cache = new TemplateCache()
    cache.setCacheablePatterns([{ pattern: 'python -m pytest * -q', reason: 'learned' }])
    cache.set('python -m pytest a.py -q', entryForDecision({ kind: 'allow', risk: 'low' }, 60_000))
    expect(cache.get('python other.py')).toBeUndefined()
  })

  it('serves a hit for --flag=value parameter variants', () => {
    const cache = new TemplateCache()
    cache.setCacheablePatterns([{ pattern: 'python run_pipeline --days=*', reason: 'learned' }])
    cache.set('python run_pipeline --days=1', entryForDecision({ kind: 'allow', risk: 'low', reason: 'ok' }, 60_000))
    const hit = cache.get('python run_pipeline --days=2')
    expect(hit).toMatchObject({ decision: 'allow', risk: 'low' })
  })

  it('persists entries across process restarts (the hook model)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-tmpl-disk-'))
    try {
      const path = join(dir, 'template-cache.json')
      const patterns = [{ pattern: 'python -m pytest * -q', reason: 'learned' }]

      // Process 1: LLM allowed one command; the skeleton entry is written through.
      const first = new TemplateCache(path)
      first.setCacheablePatterns(patterns)
      first.set('python -m pytest a.py -q', entryForDecision({ kind: 'allow', risk: 'low', reason: 'ok' }, 60_000))

      // Process 2: a fresh cache from disk serves the skeleton variant.
      const second = new TemplateCache(path)
      second.setCacheablePatterns(patterns)
      expect(second.get('python -m pytest b.py -q')).toMatchObject({ decision: 'allow' })

      // Commands matching no learned pattern never reach the file.
      const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, unknown> }
      expect(Object.keys(onDisk.entries)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps memory-only mode when constructed without a path', () => {
    const cache = new TemplateCache()
    cache.setCacheablePatterns([{ pattern: 'python -m pytest * -q', reason: 'learned' }])
    cache.set('python -m pytest a.py -q', entryForDecision({ kind: 'allow', risk: 'low' }, 60_000))
    expect(cache.size).toBe(1)
  })
})

describe('GuardService: template cache', () => {
  it('serves a learned template hit for a parameter variant without LLM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-tmpl-svc-'))
    try {
      const config = makeConfig()
      config.rulesPath = join(dir, 'rules.json')
      config.defaultRulesPath = join(dir, 'defaults.json')
      config.cachePath = join(dir, 'cache.json')
      const sessionCache = new SessionLruCache(config.sessionCacheSize)
      const persistentCache = new PersistentCache(config.cachePath)
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
      const templateCache = new TemplateCache()
      templateCache.setCacheablePatterns([{ pattern: 'python -m pytest * -q', reason: 'learned template' }])
      const service = new GuardService({
        config,
        rules: loadRules(config.rulesPath, config.defaultRulesPath),
        sessionCache,
        persistentCache,
        llmReviewer: llm,
        fileTracker,
        templateCache,
      })

      const first = await service.decide(shell('python -m pytest a.py -q'))
      expect(first).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(llm.calls).toHaveLength(1)

      const second = await service.decide(shell('python -m pytest b.py -q'))
      expect(second).toMatchObject({ kind: 'allow', source: 'learned', cached: true })
      expect(service.stats.learnedHits).toBe(1)
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let template cache bypass always-review commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-tmpl-svc-'))
    try {
      const config = makeConfig()
      config.rulesPath = join(dir, 'rules.json')
      config.defaultRulesPath = join(dir, 'defaults.json')
      config.cachePath = join(dir, 'cache.json')
      const sessionCache = new SessionLruCache(config.sessionCacheSize)
      const persistentCache = new PersistentCache(config.cachePath)
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
      const templateCache = new TemplateCache()
      templateCache.setCacheablePatterns([{ pattern: 'bash *', reason: 'learned template' }])
      const service = new GuardService({
        config,
        rules: loadRules(config.rulesPath, config.defaultRulesPath),
        sessionCache,
        persistentCache,
        llmReviewer: llm,
        fileTracker,
        templateCache,
      })

      await service.decide(shell('bash setup.sh'))
      const second = await service.decide(shell('bash other.sh'))
      expect(second.source).toBe('llm')
      expect(llm.calls).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
