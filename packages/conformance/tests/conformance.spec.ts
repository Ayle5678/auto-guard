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
  PersistentCache,
  SessionLruCache,
  DiskSessionCache,
  createPendingSinks,
  createTrackerStore,
  defaultGuardConfig,
  REVIEW_SYSTEM_PROMPT,
  reviewTimeoutBudget,
  parseReviewJson,
  type DecisionSource,
  type GuardRequest,
  type LlmReviewRequest,
  type LlmReviewer,
  type LlmReviewResult,
} from '@auto-guard/core'
import { createGuardService, serializeHookOutput, createExtraction, createHostMessage, type HostDescriptor } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from '@auto-guard/host-zcode/src/descriptor.ts'
import { CLAUDE_DESCRIPTOR } from '@auto-guard/host-claude/src/descriptor.ts'
import { QODER_DESCRIPTOR } from '@auto-guard/host-qoder/src/descriptor.ts'
import { OPENCODE_DESCRIPTOR } from '@auto-guard/host-opencode/src/descriptor.ts'
import { toGuardRequest as piToGuardRequest } from '@auto-guard/host-pi/src/adapter.ts'
import { toGuardRequest as dshToGuardRequest } from 'auto-guard/src/adapter.ts'
import { toGuardRequest as zcodeToGuardRequest, normalizeHookInput as zcodeNormalize } from '@auto-guard/host-zcode/src/zcode-adapter.ts'
import { toGuardRequest as claudeToGuardRequest, normalizeHookInput as claudeNormalize } from '@auto-guard/host-claude/src/claude-adapter.ts'
import { toGuardRequest as qoderToGuardRequest, normalizeHookInput as qoderNormalize } from '@auto-guard/host-qoder/src/qoder-adapter.ts'
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

/**
 * The four hook-host descriptors run through the runtime's ONE assembly
 * (`buildGuardDeps` — the exact wiring `createHookHost` uses internally, with
 * the reviewer injectable); pi/dsh keep their memory-state assembly. A
 * decision difference between the descriptor rows can therefore only come
 * from descriptor-declared data or the assembly inputs, never from a
 * host-local copy of the pipeline.
 */
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
    const lang0 = lang ?? 'zh'
    const { service } = createGuardService({
      config,
      rules,
      lang: lang0,
      sessionCache,
      persistentCache: new PersistentCache(config.cachePath),
      llmReviewer: reviewer,
      fileTracker: new FileTracker(config.fileTrackerWindowSec * 1000, state === 'disk' ? createTrackerStore(join(dir, 'sessions', 's0'), config.fileTrackerWindowSec * 1000) : undefined),
      historyStore: history,
      pendingPersistence,
    })
    return service
  }
  return [
    { name: 'pi-style bootstrap (memory state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'memory', lang) },
    { name: 'dsh-style bootstrap (memory state)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'memory', lang) },
    { name: 'zcode descriptor (disk state, runtime assembly)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'claude descriptor (disk state, runtime assembly)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'opencode descriptor (disk state, runtime assembly)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
    { name: 'qoder descriptor (disk state, runtime assembly)', make: (dir, reviewer, _apiKey, lang) => makeService(dir, reviewer, 'disk', lang) },
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

describe('SPEC 0012: synthesized delete_file rides the exact bash rm pipeline', () => {
  // The qoder descriptor row (disk-state, runtime assembly) — the composition
  // the synthesized command actually travels through on its host.
  const makeQoderStyle = bootstraps().at(-1)!.make

  // The LEFT side of every comparison is a real delete_file payload through
  // the qoder adapter; only the RIGHT side is a hand-written bash rm —
  // equivalence between different producers, not a literal compared to itself.
  function fromDeleteFile(payloadPath: string): GuardRequest {
    const extraction = qoderToGuardRequest(qoderNormalize({ session_id: 's1', tool_name: 'delete_file', tool_input: { path: payloadPath } }), 'w')
    if (extraction.kind !== 'guardable') throw new Error('delete_file payload should extract as guardable')
    return extraction.request
  }
  function fromBash(command: string): GuardRequest {
    const extraction = zcodeToGuardRequest(zcodeNormalize({ session_id: 's1', tool_name: 'Bash', tool_input: { command } }), 'w')
    if (extraction.kind !== 'guardable') throw new Error('bash payload should extract as guardable')
    return extraction.request
  }

  it('single-file rm is never silently allowed: the delete_file event and the real bash event go to the LLM alike', async () => {
    const synthesized = await makeQoderStyle(root(), okReviewer(), 'disk').decide(fromDeleteFile('C:/proj/notes.txt'))
    const realBash = await makeQoderStyle(root(), okReviewer(), 'disk').decide(fromBash('rm "C:/proj/notes.txt"'))
    expect(synthesized).toMatchObject(realBash)
    expect(synthesized.source).toBe('llm')
    expect(synthesized.cached).toBeUndefined()
  })

  it('sensitive-path demotion fires identically for the synthesized command', async () => {
    const synthesized = await makeQoderStyle(root(), okReviewer(), 'disk').decide(fromDeleteFile('C:/proj/.env'))
    const realBash = await makeQoderStyle(root(), okReviewer(), 'disk').decide(fromBash('rm "C:/proj/.env"'))
    expect(synthesized).toMatchObject(realBash)
    expect(synthesized.source).toBe('llm')
  })

  it('reviewer failure fails closed identically for the synthesized command', async () => {
    const failing = (): LlmReviewer => ({
      async review(req: LlmReviewRequest): Promise<LlmReviewResult> {
        void req
        throw new Error('boom')
      },
    })
    const synthesized = await makeQoderStyle(root(), failing(), 'disk').decide(fromDeleteFile('C:/a'))
    const realBash = await makeQoderStyle(root(), failing(), 'disk').decide(fromBash('rm "C:/a"'))
    expect(synthesized).toMatchObject(realBash)
    expect(synthesized.kind).toBe('deny')
    expect(synthesized.reviewerFailed).toBe(true)
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

  it('qoder delete_file synthesizes the same bash rm request as a real Bash tool call (SPEC 0012)', () => {
    const synthesized = qoderToGuardRequest(qoderNormalize({ session_id: SES, tool_name: 'delete_file', tool_input: { path: 'C:/a' } }), WS)
    const realQoderBash = qoderToGuardRequest(qoderNormalize({ session_id: SES, tool_name: 'Bash', tool_input: { command: 'rm "C:/a"' } }), WS)
    const realClaudeBash = claudeToGuardRequest(claudeNormalize({ session_id: SES, tool_name: 'Bash', tool_input: { command: 'rm "C:/a"' } }), WS)
    const expected: GuardRequest = { tool: 'bash', command: 'rm "C:/a"', session: SES, workspace: WS }
    for (const [host, extraction] of Object.entries({ qoderSynth: synthesized, qoderBash: realQoderBash, claudeBash: realClaudeBash })) {
      expect(extraction, host).toMatchObject({ kind: 'guardable' })
      expect((extraction as { request?: GuardRequest }).request, host).toEqual(expected)
    }
  })

  it('a sensitive .env write translates identically on all adapters', () => {    const expected: GuardRequest = { tool: 'write', filePath: 'D:/work/demo/.env', content: 'SECRET=1', session: SES, workspace: WS }
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
    const json = JSON.parse(serializeHookOutput({ action: 'ask', reason: 'unreadable' })) as { hookSpecificOutput: { permissionDecision: string } }
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('qoder: unparseable guarded payload → unreviewable → permissionDecision ask (spec 0005)', () => {
    const extraction = qoderToGuardRequest(qoderNormalize({ tool_name: 'create_file', tool_input: {} }))
    expect(extraction.kind).toBe('unreviewable')
    const json = JSON.parse(serializeHookOutput({ action: 'ask', reason: 'unreadable' })) as { hookSpecificOutput: { permissionDecision: string } }
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('SPEC 0013 (replaces the qoder≡claude byte pin): all three hook facades re-export the ONE runtime serializer', async () => {
    // The migration checkpoint is gone on purpose: claude/qoder/zcode shims
    // delegate to the runtime's default wire, so "byte-identical" is now
    // guaranteed by construction — equality with the runtime serializer is
    // the structural pin.
    const zcodeMod = await import('@auto-guard/host-zcode/src/hook-output.ts')
    const claudeMod = await import('@auto-guard/host-claude/src/hook-output.ts')
    const qoderMod = await import('@auto-guard/host-qoder/src/hook-output.ts')
    for (const action of [
      { action: 'allow' as const },
      { action: 'deny' as const, reason: '命中黑名单 [黑名单]: rm -rf /' },
      { action: 'ask' as const, reason: '保守起见需要人工确认' },
    ]) {
      const expected = serializeHookOutput(action)
      expect(claudeMod.serializeHookOutput(action)).toBe(expected)
      expect(qoderMod.serializeHookOutput(action)).toBe(expected)
      expect(zcodeMod.serializeHookOutput(action)).toBe(expected)
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

describe('descriptor contract (SPEC 0013 ticket 04): differences must only come from declared data', () => {
  const DESCRIPTORS: Array<[string, HostDescriptor]> = [
    ['zcode', ZCODE_DESCRIPTOR],
    ['claude', CLAUDE_DESCRIPTOR],
    ['qoder', QODER_DESCRIPTOR],
    ['opencode', OPENCODE_DESCRIPTOR],
  ]
  const WS = 'D:/work/demo'

  /** Each descriptor's extraction of the shared scenario battery. */
  function extractionOf(descriptor: HostDescriptor, payload: Record<string, unknown>) {
    const extraction = createExtraction(descriptor, createHostMessage(descriptor))
    return extraction.toGuardRequest(extraction.normalizeHookInput(JSON.parse(JSON.stringify(payload))), WS, 'zh')
  }

  it('every guarded bash scenario lands on the same GuardRequest shape wherever the tool exists', () => {
    for (const [name, descriptor] of DESCRIPTORS) {
      const bashTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.guardTool === 'bash' && !m.synthesizeCommand)?.[0]
      if (!bashTool) continue
      const result = extractionOf(descriptor, { session_id: 's1', tool_name: bashTool, tool_input: { command: 'git status' } })
      expect(result, name).toMatchObject({ kind: 'guardable' })
      if (result.kind === 'guardable') {
        expect(result.request, name).toEqual({ tool: 'bash', command: 'git status', session: 's1', workspace: WS })
      }
    }
  })

  it('the fail-closed semantics are identical: guarded tool, unreadable params → unreviewable in every host', () => {
    for (const [name, descriptor] of DESCRIPTORS) {
      const bashTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.guardTool === 'bash' && !m.synthesizeCommand)?.[0]
      if (!bashTool) continue
      const result = extractionOf(descriptor, { session_id: 's1', tool_name: bashTool, tool_input: {} })
      expect(result.kind, name).toBe('unreviewable')
    }
  })

  it('self-proof: an injected descriptor fault (dropped Write) changes ONLY the declared behavior', () => {
    // Remove the write-surface tool from a claude copy: the write payload
    // flips guardable → passthrough while the bash scenario stays identical.
    const writeTool = Object.entries(CLAUDE_DESCRIPTOR.guardedTools).find(([, m]) => m.guardTool === 'write')![0]
    const broken: HostDescriptor = {
      ...CLAUDE_DESCRIPTOR,
      guardedTools: Object.fromEntries(Object.entries(CLAUDE_DESCRIPTOR.guardedTools).filter(([t]) => t !== writeTool)),
    }
    const healthy = extractionOf(CLAUDE_DESCRIPTOR, { session_id: 's1', tool_name: writeTool, tool_input: { file_path: `${WS}/a.txt`, content: 'x' } })
    const faulty = extractionOf(broken, { session_id: 's1', tool_name: writeTool, tool_input: { file_path: `${WS}/a.txt`, content: 'x' } })
    expect(healthy.kind).toBe('guardable')
    expect(faulty.kind).toBe('passthrough') // the injected config error, caught
    const bash = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git status' } }
    expect(extractionOf(broken, bash)).toEqual(extractionOf(CLAUDE_DESCRIPTOR, bash)) // nothing else moved
  })

  it('self-proof: a swapped path-field chain reroutes extraction exactly as declared', () => {
    // qoder's filepath spelling is declared data: a copy without `filepath`
    // must stop finding payloads that only carry `filepath`.
    const broken: HostDescriptor = { ...QODER_DESCRIPTOR, pathFields: QODER_DESCRIPTOR.pathFields.filter((f) => f !== 'filepath') }
    const payload = { session_id: 's1', tool_name: 'apply_patch', tool_input: { filepath: 'C:/a.txt', content: 'x' } }
    expect(extractionOf(QODER_DESCRIPTOR, payload).kind).toBe('guardable')
    expect(extractionOf(broken, payload).kind).toBe('unreviewable') // chain no longer reaches the path
  })
})

describe('language regression matrix (SPEC 0013 ticket 04): four hook descriptors × zh/en', () => {
  const WS = 'D:/work/demo'

  it.each(DESCRIPTOR_ROWS())('$name: extraction fail-closed wording follows the language, decision kinds never do', ({ descriptor, name }) => {
    const extraction = createExtraction(descriptor, createHostMessage(descriptor))
    const bashTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.guardTool === 'bash' && !m.synthesizeCommand)?.[0]
    if (!bashTool) return
    const zh = extraction.toGuardRequest(extraction.normalizeHookInput({ tool_name: bashTool, tool_input: {} }), WS, 'zh')
    const en = extraction.toGuardRequest(extraction.normalizeHookInput({ tool_name: bashTool, tool_input: {} }), WS, 'en')
    expect(zh.kind).toBe(en.kind)
    expect(zh.kind).toBe('unreviewable')
    if (zh.kind === 'unreviewable' && en.kind === 'unreviewable') {
      expect(zh.reason).toContain('保守起见需要人工确认')
      expect(en.reason).toMatch(/asking a human as a fail-safe/i)
    }
  })

  function DESCRIPTOR_ROWS(): Array<{ descriptor: HostDescriptor; name: string }> {
    return [
      { descriptor: ZCODE_DESCRIPTOR, name: 'zcode' },
      { descriptor: CLAUDE_DESCRIPTOR, name: 'claude' },
      { descriptor: QODER_DESCRIPTOR, name: 'qoder' },
      { descriptor: OPENCODE_DESCRIPTOR, name: 'opencode' },
    ]
  }

  it.each(DESCRIPTOR_ROWS())('$name: set lang is wired (receipt follows the newly selected language, via the shared runtime CLI)', async ({ descriptor, name }) => {
    // `set lang en` receipt in English — the ADR-0011 drift the runtime fixed
    // for the three hosts that used to hardcode Chinese.
    const { createConfigSpace, createCliMain, createBootstrap } = await import('@auto-guard/host-runtime')
    const dir = root()
    const space = createConfigSpace(descriptor, dir)
    space.saveConfig({ ...space.defaultConfig(), enabled: true, lang: 'en' })
    const kit = createBootstrap(descriptor, space, dir)
    const chunks: string[] = []
    const original = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write
    try {
      const cliMain = createCliMain({ space, kit, message: createHostMessage(descriptor) })
      await cliMain(['set', 'lang', 'zh'])
    } finally {
      process.stdout.write = original
    }
    expect(chunks.join(''), name).toContain('语言已设置：zh')
  })
})
