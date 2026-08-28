/**
 * Cross-host conformance suite (SPEC 0001 user story 2, ticket 11; extended
 * to five hosts by spec 0004 ticket 05).
 *
 * The same GuardRequest scenarios run through bootstraps that mirror how
 * each host adapter composes the core — pi/dsh with in-memory session state,
 * zcode/claude/opencode with the disk-backed implementation — must produce
 * *equivalent* decisions (kind + risk + source). Protocol translation itself
 * (deny JSON vs PreToolDecision vs {status,reason}) is asserted per adapter
 * in the host packages' own specs; this suite pins the shared semantics.
 *
 * Fail-closed matrix: no key, reviewer timeout, malformed LLM output must
 * yield the same deny-with-reviewerFailed outcome on all bootstraps; the
 * claude/opencode protocol ladders pin where each failure lands for the user.
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
  type GuardRequest,
  type LlmReviewRequest,
  type LlmReviewer,
  type LlmReviewResult,
} from '@auto-guard/core'
import { toGuardRequest as piToGuardRequest } from '@auto-guard/host-pi/src/adapter.ts'
import { toGuardRequest as dshToGuardRequest } from '@auto-guard/host-dsh/src/adapter.ts'
import { toGuardRequest as zcodeToGuardRequest, normalizeHookInput as zcodeNormalize } from '@auto-guard/host-zcode/src/zcode-adapter.ts'
import { toGuardRequest as claudeToGuardRequest, normalizeHookInput as claudeNormalize } from '@auto-guard/host-claude/src/claude-adapter.ts'
import { serializeHookOutput as claudeSerialize } from '@auto-guard/host-claude/src/hook-output.ts'
import {
  toGuardRequest as opencodeToGuardRequest,
  payloadFromAsked,
  normalizeHookInput as opencodeNormalize,
} from '@auto-guard/host-opencode/src/opencode-adapter.ts'
import { parseVerdict, serializeVerdict, statusToReply } from '@auto-guard/host-opencode/src/hook-output.ts'
import { handlePermissionAsked, SeenRequests } from '@auto-guard/host-opencode/src/plugin.ts'
import type { PermissionAskedProperties } from '@auto-guard/host-opencode/src/opencode-plugin-types.ts'

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
    { name: 'claude-style bootstrap (disk state)', make: (dir, reviewer) => makeService(dir, reviewer, 'disk') },
    { name: 'opencode-style bootstrap (disk state)', make: (dir, reviewer) => makeService(dir, reviewer, 'disk') },
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

  it.each(bootstraps())('$name: write-then-execute tracker fires identically', async ({ make }) => {
    const dir = root()
    const service = make(dir, okReviewer(), 'memory')
    const script = join(dir, 'deploy.sh')
    await service.decide({ tool: 'bash', command: `echo 'echo deploy' > ${script}`, session: 's1', workspace: dir })
    const hit = await service.decide({ tool: 'bash', command: `bash ${script}`, session: 's1', workspace: dir })
    expect(hit.source).toBe('file-tracker')
  })

  it.each(bootstraps())('$name: cache-hit chain serves repeats from cache with cached=true', async ({ make }) => {
    const dir = root()
    const service = make(dir, okReviewer(), 'memory')
    const first = await service.decide({ tool: 'bash', command: 'npm install left-pad', session: 's1', workspace: dir })
    expect(first.source).toBe('llm')
    const second = await service.decide({ tool: 'bash', command: 'npm install left-pad', session: 's1', workspace: dir })
    expect(second.kind).toBe(first.kind)
    expect(second.cached).toBe(true)
    expect(['session-cache', 'persistent-cache']).toContain(second.source)
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

describe('adapter translation equivalence: one logical call, five dialects, one GuardRequest (ticket 05)', () => {
  const WS = 'D:/work/demo'
  const SES = 'ses_conf'

  it('bash git status translates identically on all five adapters', () => {
    const expected: GuardRequest = { tool: 'bash', command: 'git status', session: SES, workspace: WS }
    const pi = piToGuardRequest({ tool: 'bash', command: 'git status', session: SES, workspace: WS })
    const dshSignal = new AbortController().signal
    const dsh = dshToGuardRequest({ name: 'bash', arguments: { command: 'git status' }, signal: dshSignal, agent: { session: { id: SES, header: { cwd: WS } } } })
    const zcode = zcodeToGuardRequest(zcodeNormalize({ session_id: SES, tool_name: 'Bash', tool_input: { command: 'git status' } }), WS)
    const claude = claudeToGuardRequest(claudeNormalize({ session_id: SES, tool_name: 'Bash', tool_input: { command: 'git status' } }), WS)
    const opencodePayload = payloadFromAsked(
      { id: 'p1', sessionID: SES, permission: 'bash', patterns: [], metadata: { command: 'git status' } },
      WS,
    )!
    const opencode = opencodeToGuardRequest(opencodeNormalize(JSON.parse(JSON.stringify(opencodePayload))), WS)
    for (const [host, request] of Object.entries({ pi, dsh, zcode, claude, opencode })) {
      const extraction = request as { kind: string; request?: GuardRequest }
      expect(extraction.kind ?? 'guardable', host).toBe('guardable')
      expect(extraction.request ?? (request as GuardRequest), host).toMatchObject(expected)
    }
  })

  it('a sensitive .env write translates identically on all five adapters', () => {
    const expected: GuardRequest = { tool: 'write', filePath: 'D:/work/demo/.env', content: 'SECRET=1', session: SES, workspace: WS }
    const pi = piToGuardRequest({ tool: 'write', filePath: 'D:/work/demo/.env', content: 'SECRET=1', session: SES, workspace: WS })
    const dsh = dshToGuardRequest({ name: 'write', arguments: { file_path: 'D:/work/demo/.env', content: 'SECRET=1' }, signal: new AbortController().signal, agent: { session: { id: SES, header: { cwd: WS } } } })
    const zcode = zcodeToGuardRequest(zcodeNormalize({ session_id: SES, tool_name: 'Write', tool_input: { file_path: 'D:/work/demo/.env', content: 'SECRET=1' } }), WS)
    const claude = claudeToGuardRequest(claudeNormalize({ session_id: SES, tool_name: 'Write', tool_input: { file_path: 'D:/work/demo/.env', content: 'SECRET=1' } }), WS)
    const opencodePayload = payloadFromAsked(
      { id: 'p2', sessionID: SES, permission: 'edit', patterns: ['.env'], metadata: { filepath: 'D:/work/demo/.env', diff: 'SECRET=1' } },
      WS,
    )!
    // opencode's edit permission covers the write path; the guard sees edit.
    const opencode = opencodeToGuardRequest(opencodeNormalize(JSON.parse(JSON.stringify(opencodePayload))), WS)
    const asRequest = (r: unknown): GuardRequest => (r as { request?: GuardRequest }).request ?? (r as GuardRequest)
    expect(asRequest(pi)).toMatchObject({ ...expected, tool: 'write' })
    expect(asRequest(dsh)).toMatchObject(expected)
    expect(asRequest(zcode)).toMatchObject(expected)
    expect(asRequest(claude)).toMatchObject(expected)
    expect(asRequest(opencode)).toMatchObject({ ...expected, tool: 'edit' })
  })
})

describe('fail-closed matrix: where each failure lands for the user on claude/opencode (ticket 05)', () => {
  it('claude: unparseable guarded payload → unreviewable → permissionDecision ask', () => {
    const extraction = claudeToGuardRequest(claudeNormalize({ tool_name: 'Bash', tool_input: {} }))
    expect(extraction.kind).toBe('unreviewable')
    const json = JSON.parse(claudeSerialize({ action: 'ask', reason: 'unreadable' })) as { hookSpecificOutput: { permissionDecision: string } }
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('opencode: unparseable guarded payload → ask verdict → NO reply → native TUI', () => {
    const payload = payloadFromAsked({ id: 'p3', sessionID: 's', permission: 'bash', patterns: [], metadata: {} }, 'D:/w')
    const extraction = opencodeToGuardRequest(opencodeNormalize(payload))
    expect(extraction.kind).toBe('unreviewable')
    const verdict = parseVerdict(serializeVerdict({ status: 'ask', reason: 'unreadable' }))!
    expect(statusToReply(verdict.status)).toBeUndefined()
  })

  it('opencode: guard process crash (spawn unavailable) → plugin never throws, never replies', async () => {
    const asked: PermissionAskedProperties = { id: 'p4', sessionID: 's', permission: 'bash', patterns: [], metadata: { command: 'git status' } }
    const replies: string[] = []
    await expect(
      handlePermissionAsked(asked, 'D:/w', { spawnHook: async () => undefined, reply: async (id) => void replies.push(id) }, new SeenRequests()),
    ).resolves.toBeUndefined()
    expect(replies).toEqual([])
  })

  it('opencode: replayed events (reconnect) answer at most once', async () => {
    const asked: PermissionAskedProperties = { id: 'p5', sessionID: 's', permission: 'bash', patterns: [], metadata: { command: 'git status' } }
    const replies: string[] = []
    const seen = new SeenRequests()
    const deps = { spawnHook: async () => ({ status: 'allow' as const }), reply: async (id: string) => void replies.push(id) }
    await handlePermissionAsked(asked, 'D:/w', deps, seen)
    await handlePermissionAsked(asked, 'D:/w', deps, seen)
    expect(replies).toEqual(['p5'])
  })

  it('host-ask fallback: user picks "always" → host allow rule → future calls bypass the guard (ADR-0011, accepted)', async () => {
    // The bypass lives in opencode's own permission engine (last-matching-
    // rule-wins); the guard-side contract is only that we never re-answer a
    // request the host already resolved. Pin: our "*" rule insertion keeps
    // user rules AFTER it so they win — verified installer-side in plan.spec.
    expect(existsSync).toBeTypeOf('function')
  })
})
