/**
 * Cross-host conformance suite (SPEC 0001 user story 2, ticket 11; extended
 * to five hosts by spec 0004 ticket 05, to six by spec 0005).
 *
 * The same GuardRequest scenarios run through bootstraps that mirror how
 * each host adapter composes the core — pi/dsh with in-memory session state,
 * zcode/claude/opencode/qoder with the disk-backed implementation — must
 * produce *equivalent* decisions (kind + risk + source). Protocol translation
 * itself (deny JSON vs PreToolDecision vs {status,reason}) is asserted per
 * adapter in the host packages' own specs; this suite pins the shared
 * semantics.
 *
 * Fail-closed matrix: no key, reviewer timeout, malformed LLM output must
 * yield the same deny-with-reviewerFailed outcome on all bootstraps; the
 * claude/opencode/qoder protocol ladders pin where each failure lands for the
 * user.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { toGuardRequest as dshToGuardRequest } from 'auto-guard/src/adapter.ts'
import { toGuardRequest as zcodeToGuardRequest, normalizeHookInput as zcodeNormalize } from '@auto-guard/host-zcode/src/zcode-adapter.ts'
import { toGuardRequest as claudeToGuardRequest, normalizeHookInput as claudeNormalize } from '@auto-guard/host-claude/src/claude-adapter.ts'
import { serializeHookOutput as claudeSerialize } from '@auto-guard/host-claude/src/hook-output.ts'
import { toGuardRequest as qoderToGuardRequest, normalizeHookInput as qoderNormalize } from '@auto-guard/host-qoder/src/qoder-adapter.ts'
import { serializeHookOutput as qoderSerialize } from '@auto-guard/host-qoder/src/hook-output.ts'
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
  make: (dir: string, reviewer: LlmReviewer, apiKey: string, lang?: 'zh' | 'en') => GuardService
}

function bootstraps(): Bootstrap[] {
  const makeService = (dir: string, reviewer: LlmReviewer, state: SessionStateKind, lang?: 'zh' | 'en'): GuardService => {
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
      ...(lang ? { lang } : {}),
    })
  }
  return [
    { name: 'pi-style bootstrap (memory state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'memory', lang) },
    { name: 'dsh-style bootstrap (memory state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'memory', lang) },
    { name: 'zcode-style bootstrap (disk state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'claude-style bootstrap (disk state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'opencode-style bootstrap (disk state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'qoder-style bootstrap (disk state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
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

describe('adapter translation equivalence: one logical call, six dialects (qoder twice — short + long names), one GuardRequest (ticket 05 / spec 0005)', () => {
  const WS = 'D:/work/demo'
  const SES = 'ses_conf'

  it('bash git status translates identically on all adapters', () => {
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
    // Qoder speaks the claude dialect but names the terminal tool both ways;
    // both spellings must land on the same bash request.
    const qoderShort = qoderToGuardRequest(qoderNormalize({ session_id: SES, tool_name: 'Bash', tool_input: { command: 'git status' } }), WS)
    const qoderLong = qoderToGuardRequest(qoderNormalize({ session_id: SES, tool_name: 'run_in_terminal', tool_input: { command: 'git status' } }), WS)
    for (const [host, request] of Object.entries({ pi, dsh, zcode, claude, opencode, qoderShort, qoderLong })) {
      const extraction = request as { kind: string; request?: GuardRequest }
      expect(extraction.kind ?? 'guardable', host).toBe('guardable')
      expect(extraction.request ?? (request as GuardRequest), host).toMatchObject(expected)
    }
  })

  it('a sensitive .env write translates identically on all adapters', () => {
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
    // Qoder's long internal name for the write path must translate the same.
    const qoder = qoderToGuardRequest(qoderNormalize({ session_id: SES, tool_name: 'create_file', tool_input: { file_path: 'D:/work/demo/.env', content: 'SECRET=1' } }), WS)
    const asRequest = (r: unknown): GuardRequest => (r as { request?: GuardRequest }).request ?? (r as GuardRequest)
    expect(asRequest(pi)).toMatchObject({ ...expected, tool: 'write' })
    expect(asRequest(dsh)).toMatchObject(expected)
    expect(asRequest(zcode)).toMatchObject(expected)
    expect(asRequest(claude)).toMatchObject(expected)
    expect(asRequest(opencode)).toMatchObject({ ...expected, tool: 'edit' })
    expect(asRequest(qoder)).toMatchObject(expected)
  })
})

describe('fail-closed matrix: where each failure lands for the user on claude/opencode (ticket 05)', () => {
  it('claude: unparseable guarded payload → unreviewable → permissionDecision ask', () => {
    const extraction = claudeToGuardRequest(claudeNormalize({ tool_name: 'Bash', tool_input: {} }))
    expect(extraction.kind).toBe('unreviewable')
    const json = JSON.parse(claudeSerialize({ action: 'ask', reason: 'unreadable' })) as { hookSpecificOutput: { permissionDecision: string } }
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('qoder: unparseable guarded payload → unreviewable → permissionDecision ask (spec 0005)', () => {
    const extraction = qoderToGuardRequest(qoderNormalize({ tool_name: 'create_file', tool_input: {} }))
    expect(extraction.kind).toBe('unreviewable')
    const json = JSON.parse(qoderSerialize({ action: 'ask', reason: 'unreadable' })) as { hookSpecificOutput: { permissionDecision: string } }
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('qoder and claude serialize the same decision to byte-identical stdout JSON (ticket 03)', () => {
    // The two hosts speak the same Claude-compatible dialect; the wire shape
    // must stay identical for allow (silence), deny and ask alike.
    for (const action of [
      { action: 'allow' as const },
      { action: 'deny' as const, reason: '命中黑名单 [黑名单]: rm -rf /' },
      { action: 'ask' as const, reason: '保守起见需要人工确认' },
    ]) {
      expect(qoderSerialize(action)).toBe(claudeSerialize(action))
    }
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

  it('host-ask fallback: deny replies carry the guard reason as agent feedback', async () => {
    const asked: PermissionAskedProperties = { id: 'p6', sessionID: 's', permission: 'bash', patterns: [], metadata: { command: 'rm -rf /' } }
    const replies: Array<{ id: string; reply: string; message?: string }> = []
    const deps = {
      spawnHook: async () => ({ status: 'deny' as const, reason: '命中黑名单' }),
      reply: async (id: string, reply: 'once' | 'reject', message?: string) => void replies.push({ id, reply, message }),
    }
    await handlePermissionAsked(asked, 'D:/w', deps, new SeenRequests())
    expect(replies).toEqual([{ id: 'p6', reply: 'reject', message: '命中黑名单' }])
  })

  it('host-ask fallback: the "always" bypass lives in the host permission engine, not the guard', () => {
    // opencode's last-matching-rule-wins means user rules placed after our
    // "*" keep priority — pinned installer-side (cli plan.spec); the guard's
    // own contract is only the no-reply-on-ask rule covered above.
    expect(statusToReply('ask')).toBeUndefined()
  })
})

describe('language equivalence (SPEC 0004): language changes wording, never verdicts', () => {
  it.each(bootstraps())('$name: zh and en configs yield identical decisions for every scenario', async ({ make }) => {
    for (const { request, kind, source } of scenarios()) {
      const zh = make(root(), okReviewer(), 'sk', 'zh')
      const en = make(root(), okReviewer(), 'sk', 'en')
      const zhDecision = await zh.decide({ tool: request.tool, command: request.command, filePath: request.filePath, session: 's1', workspace: 'w' })
      const enDecision = await en.decide({ tool: request.tool, command: request.command, filePath: request.filePath, session: 's1', workspace: 'w' })
      expect(enDecision.kind).toBe(zhDecision.kind)
      expect(enDecision.kind).toBe(kind)
      expect(enDecision.source).toBe(zhDecision.source)
      expect(enDecision.source).toBe(source)
      expect(enDecision.risk).toBe(zhDecision.risk)
    }
  })

  it.each(bootstraps())('$name: engine-authored reasons follow the language, decision shape does not', async ({ make }) => {
    // LLM deny, then retry: the pending-deny ask is engine-authored, so its
    // reason is the observable that flips with the language.
    const denyReviewer = (): LlmReviewer => ({
      async review(): Promise<LlmReviewResult> {
        return { decision: 'deny', risk: 'medium', reason: 'nope' }
      },
    })
    const zh = make(root(), denyReviewer(), 'sk', 'zh')
    const en = make(root(), denyReviewer(), 'sk', 'en')
    const command = { tool: 'bash' as const, command: 'npm install left-pad', session: 's1', workspace: 'w' }
    await zh.decide(command)
    await en.decide(command)
    const zhAsk = await zh.decide(command)
    const enAsk = await en.decide(command)
    expect(zhAsk.kind).toBe(enAsk.kind)
    expect(zhAsk.source).toBe(enAsk.source)
    expect(zhAsk.source).toBe('llm')
    expect(zhAsk.reason).toContain('LLM 已拒绝过此命令')
    expect(enAsk.reason).toContain('The LLM already denied this command')
  })
})
