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
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return { decision: 'allow', risk: 'low', reason: 'ok' }
  }
}

/** The engine-tuning slice only (SPEC 0019 ticket 04). */
function makeTuning(): GuardTuning {
  return {
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    alwaysReviewCacheTtlMinutes: 30,
    onTimeout: 'deny',
    fileTrackerDefault: 'ask',
    historyEnabled: false,
    examineEnabled: false,
    historyMinTotal: 4,
    historyMinLlm: 1,
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
      const sessionCache = new SessionLruCache(16)
      const persistentCache = new PersistentCache(join(dir, 'cache.json'))
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(5 * 1000)
      const templateCache = new TemplateCache()
      templateCache.setCacheablePatterns([{ pattern: 'python -m pytest * -q', reason: 'learned template' }])
      const service = new GuardService({
        config: makeTuning(),
        rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
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
      const sessionCache = new SessionLruCache(16)
      const persistentCache = new PersistentCache(join(dir, 'cache.json'))
      const llm = new StubReviewer()
      const fileTracker = new FileTracker(5 * 1000)
      const templateCache = new TemplateCache()
      templateCache.setCacheablePatterns([{ pattern: 'bash *', reason: 'learned template' }])
      const service = new GuardService({
        config: makeTuning(),
        rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
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
