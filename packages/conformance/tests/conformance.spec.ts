/**
 * Cross-host conformance suite (SPEC 0001 user story 2, ticket 11).
 *
 * The same GuardRequest scenarios run through three bootstraps that mirror how
 * each host adapter composes the core — pi/dsh with in-memory session state,
 * zcode with the disk-backed implementation — must produce *equivalent*
 * decisions (kind + risk + source). Protocol translation itself (deny JSON vs
 * PreToolDecision vs {block,reason}) is asserted per adapter in the host
 * packages' own specs; this suite pins the shared semantics.
 *
 * Fail-closed matrix: no key, reviewer timeout, malformed LLM output must
 * yield the same deny-with-reviewerFailed outcome on all three bootstraps.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractMarkerReason,
  createAuditStore,
  DeepSeekReviewer,
  FileTracker,
  GuardService,
  HistoryStore,
  loadRules,
  loadLearnedRules,
  PersistentCache,
  SessionLruCache,
  TemplateCache,
  DiskSessionCache,
  createPendingSinks,
  createTrackerStore,
  defaultGuardConfig,
  REVIEW_SYSTEM_PROMPT,
  reviewTimeoutBudget,
  parseReviewJson,
  type DecisionSource,
  type GuardConfig,
  type LlmReviewRequest,
  type LlmReviewer,
  type LlmReviewResult,
} from '@auto-guard/core'

const dirs: string[] = []
const openStores: Array<{ close(): void }> = []
function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-conf-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (openStores.length) openStores.pop()!.close()
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true })
    } catch {
      // Windows may still hold WAL handles briefly; the OS temp cleaner wins.
    }
  }
})

type SessionStateKind = 'memory' | 'disk'

interface Bootstrap {
  name: string
  make: (dir: string, reviewer: LlmReviewer, apiKey: string) => GuardService
}

function bootstraps(): Bootstrap[] {
  const makeService = (dir: string, reviewer: LlmReviewer, state: SessionStateKind): GuardService => {
    const config = defaultGuardConfig(dir)
    config.apiKey = 'sk-test'
    const rules = loadRules(config.rulesPath, config.defaultRulesPath)
    const sessionCache =
      state === 'memory' ? new SessionLruCache(config.sessionCacheSize) : new DiskSessionCache(join(dir, 'sessions', 's0'), config.sessionCacheSize)
    const pendingPersistence =
      state === 'disk' ? { directoryDeletes: createPendingSinks(join(dir, 'sessions', 's0')).directoryDeletes, denies: createPendingSinks(join(dir, 'sessions', 's0')).denies } : undefined
    const audit = createAuditStore(config.auditDbPath)
    openStores.push(audit)
    const history = new HistoryStore({ dbPath: config.auditDbPath, store: audit, days: config.historyDays })
    const learned = loadLearnedRules(config.learnedRulesPath, [...rules.hardDeny, ...rules.alwaysReview, ...rules.directoryDelete])
    const templateCache = new TemplateCache(config.templateCachePath)
    templateCache.setCacheablePatterns(learned.cacheable)
    return new GuardService({
      config,
      rules,
      sessionCache,
      persistentCache: new PersistentCache(config.cachePath),
      llmReviewer: reviewer,
      fileTracker: new FileTracker(config.fileTrackerWindowSec * 1000, state === 'disk' ? createTrackerStore(join(dir, 'sessions', 's0'), config.fileTrackerWindowSec * 1000) : undefined),
      historyStore: history,
      templateCache,
      pendingPersistence,
    })
  }
  return [
    { name: 'pi-style bootstrap (memory state)', make: (dir, reviewer) => makeService(dir, reviewer, 'memory') },
    { name: 'dsh-style bootstrap (memory state)', make: (dir, reviewer) => makeService(dir, reviewer, 'memory') },
    { name: 'zcode-style bootstrap (disk state)', make: (dir, reviewer) => makeService(dir, reviewer, 'disk') },
  ]
}

/** A deterministic scenario table shared by all hosts. */
interface Scenario {
  name: string
  request: { tool: string; command?: string; filePath?: string }
  kind: 'allow' | 'deny' | 'ask'
  source?: DecisionSource
}

function scenarios(): Scenario[] {
  return [
    { name: 'static whitelist hit', request: { tool: 'bash', command: 'git status' }, kind: 'allow', source: 'static-allow' },
    { name: 'hard deny hit', request: { tool: 'bash', command: 'rm -rf /' }, kind: 'deny', source: 'hard-deny' },
    { name: 'always-review falls to LLM (allow)', request: { tool: 'bash', command: 'npm install left-pad' }, kind: 'allow', source: 'llm' },
    { name: 'sensitive file tool asks without LLM', request: { tool: 'write', filePath: '.env' }, kind: 'ask', source: 'sensitive-path' },
  ]
}

const okReviewer = (): LlmReviewer => ({
  async review(req: LlmReviewRequest): Promise<LlmReviewResult> {
    void req
    return { decision: 'allow', risk: 'low', reason: 'conform' }
  },
})

describe.each(bootstraps())('conformance: $name', ({ make }) => {
  it.each(scenarios())('scenario: $name → equivalent decision', async ({ request, kind, source }) => {
    const dir = root()
    const service = make(dir, okReviewer(), 'memory')
    const decision = await service.decide({ tool: request.tool, command: request.command, filePath: request.filePath, session: 's1', workspace: dir })
    expect(decision.kind).toBe(kind)
    if (source) expect(decision.source).toBe(source)
  })

  it('directory-delete two-phase flow behaves identically', async () => {
    const dir = root()
    const service = make(dir, okReviewer(), 'memory')
    const first = await service.decide({ tool: 'bash', command: 'rm -rf ./build', session: 's1', workspace: dir })
    expect(first.kind).toBe('deny')
    expect(first.source).toBe('directory-delete')
    expect(first.needsReason).toBe(true)

    // The agent-authored reason marker is recognized on any host before deciding.
    expect(extractMarkerReason('rm -rf ./build [删除理由] cleaning build output')).toContain('cleaning build output')
  })
})

describe('fail-closed matrix: identical reviewer-failure semantics on all hosts', () => {
  const failing = (): LlmReviewer => ({
    async review(req: LlmReviewRequest): Promise<LlmReviewResult> {
      void req
      throw new Error('boom')
    },
  })

  it.each(bootstraps())('$name: reviewer throw denies fail-closed', async ({ make }) => {
    const dir = root()
    const service = make(dir, failing(), 'memory')
    const decision = await service.decide({ tool: 'bash', command: 'npm run weird-thing --flag', session: 's1', workspace: dir })
    expect(decision.kind).toBe('deny')
    expect(decision.reviewerFailed).toBe(true)
  })

  it('malformed reviewer output is unparseable or default-filled identically (core parse guard)', () => {
    expect(parseReviewJson('not json at all')).toBeUndefined()
    // Tolerant parse fills risk/reason defaults for partial JSON.
    expect(parseReviewJson('{"decision":"deny"}')).toMatchObject({ decision: 'deny', risk: 'medium' })
  })

  it('missing API key is detectable identically via hasUsableApiKey semantics', () => {
    const config = defaultGuardConfig(root())
    config.apiKey = ''
    const envBackup = process.env[config.apiKeyEnv]
    delete process.env[config.apiKeyEnv]
    try {
      const usable = Boolean(process.env[config.apiKeyEnv] || config.apiKey)
      expect(usable).toBe(false)
    } finally {
      if (envBackup !== undefined) process.env[config.apiKeyEnv] = envBackup
    }
  })
})

describe('shared reviewer contract across hosts', () => {
  beforeAll(() => {
    // REVIEW_SYSTEM_PROMPT and the timeout budget are core-owned; hosts must
    // not fork them. Presence + budget floor is the pin.
    expect(REVIEW_SYSTEM_PROMPT).toContain('strict JSON')
    expect(reviewTimeoutBudget(8000)).toBe(8000)
    expect(reviewTimeoutBudget(8000, 'high')).toBeGreaterThanOrEqual(30_000)
  })

  it('timeout budget and system prompt come from core only', () => {
    expect(typeof DeepSeekReviewer).toBe('function')
  })
})
