import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentCache, SessionLruCache } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { loadRules } from '../src/rules.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  constructor(private readonly result: LlmReviewResult) {}
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return this.result
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

function setup(llmResult: LlmReviewResult) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-guard-risk-'))
  const sessionCache = new SessionLruCache(16)
  const persistentCache = new PersistentCache(join(dir, 'cache.json'))
  const llm = new StubReviewer(llmResult)
  const fileTracker = new FileTracker(5 * 1000)
  const service = new GuardService({
    config: makeTuning(),
    rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
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
