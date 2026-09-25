/**
 * SPEC 0019 ticket 02: the memory-consultation priority order —
 * session memory → pending deny → persistent cache — has a single owner
 * (consultMemories), pinned here through the cacheable-command path.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSessionKey, buildWorkspaceKey, entryForDecision, PersistentCache, SessionLruCache, sessionMemoryEntry } from '../src/cache.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { GuardService } from '../src/guard-service.ts'
import { memorySink } from '../src/persist-map.ts'
import { loadRules } from '../src/rules.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  constructor(private readonly result: LlmReviewResult) {}
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return this.result
  }
}

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

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ag-mem-priority-'))
  const sessionCache = new SessionLruCache(16)
  const persistentCache = new PersistentCache(join(dir, 'cache.json'))
  const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'llm ok' })
  const service = new GuardService({
    config: makeTuning(),
    rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
    sessionCache,
    persistentCache,
    llmReviewer: llm,
    fileTracker: new FileTracker(5 * 1000),
  })
  const shell = (command: string): GuardRequest => ({ tool: 'bash', command, session: 's1', workspace: '/ws' })
  return { service, sessionCache, persistentCache, shell, dir }
}

describe('memory priority order (ADR-0021 single owner)', () => {
  it('a session deny outranks an older persistent allow', async () => {
    const { service, sessionCache, persistentCache, shell, dir } = setup()
    try {
      sessionCache.set(buildSessionKey('s1', '/ws', 'weird-tool --flag'), sessionMemoryEntry('deny', 'user said no'))
      persistentCache.set(buildWorkspaceKey('/ws', 'weird-tool --flag'), entryForDecision({ kind: 'allow', risk: 'low', reason: 'old allow' }, 60_000))
      const d = await service.decide(shell('weird-tool --flag'))
      expect(d).toMatchObject({ kind: 'deny', source: 'session-cache', reason: 'user said no' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a pending deny asks before a persistent allow can mask it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-mem-priority-'))
    const shell = (command: string): GuardRequest => ({ tool: 'bash', command, session: 's1', workspace: '/ws' })
    try {
      // The LLM denied the command earlier (recorded into a shared pending
      // sink); a stale persistent allow from a previous session must not mask
      // it on the next decide.
      const pendingDenies: Record<string, unknown> = {}
      const denying = new StubReviewer({ decision: 'deny', risk: 'medium', reason: 'no' })
      const buildService = (persistent: PersistentCache) =>
        new GuardService({
          config: makeTuning(),
          rules: loadRules(join(dir, 'rules.json'), join(dir, 'defaults.json')),
          sessionCache: new SessionLruCache(16),
          persistentCache: persistent,
          llmReviewer: denying,
          fileTracker: new FileTracker(5 * 1000),
          pendingPersistence: { denies: memorySink(pendingDenies) },
        })

      // Phase 1 — no memory at all: the LLM denies and the pending is recorded.
      await buildService(new PersistentCache(join(dir, 'fresh.json'))).decide(shell('weird-tool --flag'))
      expect(denying.calls).toHaveLength(1)

      // Phase 2 — a stale persistent allow exists, but the pending deny wins.
      const stale = new PersistentCache(join(dir, 'stale.json'))
      stale.set(buildWorkspaceKey('/ws', 'weird-tool --flag'), entryForDecision({ kind: 'allow', risk: 'low', reason: 'stale allow' }, 60_000))
      const d = await buildService(stale).decide(shell('weird-tool --flag'))
      expect(d).toMatchObject({ kind: 'ask', source: 'llm' })
      // The pending deny served the repeat — no new LLM call, no persistent hit.
      expect(denying.calls).toHaveLength(1)
      expect(d.reason).toContain('已拒绝过')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('with no session memory and no pending deny, the persistent allow serves', async () => {
    const { service, persistentCache, shell, dir } = setup()
    try {
      persistentCache.set(buildWorkspaceKey('/ws', 'weird-tool --flag'), entryForDecision({ kind: 'allow', risk: 'low', reason: 'past allow' }, 60_000))
      const d = await service.decide(shell('weird-tool --flag'))
      expect(d).toMatchObject({ kind: 'allow', source: 'persistent-cache', reason: 'past allow' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
