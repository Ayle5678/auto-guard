/**
 * Ask escape-hatch contract in the engine (ADR-0019): a `guard ask` resolution
 * lands in the session cache under the same key the next identical call looks
 * up — shell commands via decideShell/cacheHit, file tools via the
 * decideFile memory lookup. Deny-session therefore suppresses the repeat ask,
 * allow-session short-circuits it, both without an LLM round-trip.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSessionKey, SessionLruCache } from '../src/cache.ts'
import { GuardService } from '../src/guard-service.ts'
import { classifyCommand, DEFAULT_RULES_FILE, loadRules } from '../src/rules.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'
import type { LlmReviewer, LlmReviewRequest } from '../src/llm.ts'

class CountingReviewer implements LlmReviewer {
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

function setup(sensitivePaths: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ag-ask-escape-'))
  const rulesPath = join(dir, 'rules.json')
  const defaultRulesPath = join(dir, 'defaults.json')
  writeFileSync(defaultRulesPath, JSON.stringify({ version: 1, sensitivePaths, staticAllow: [], hardDeny: [], directoryDelete: [], directoryDeleteGuards: [], userConfirmed: [], cacheable: [], alwaysReview: [], staticAllowGuards: [] }))
  const sessionCache = new SessionLruCache(16)
  // The reviewer always asks — the deterministic pre-LLM ask every escape
  // scenario starts from.
  const llm = new CountingReviewer({ decision: 'ask', risk: 'medium', reason: '需要人工确认' })
  const service = new GuardService({
    config: makeTuning(),
    rules: loadRules(rulesPath, defaultRulesPath),
    sessionCache,
    persistentCache: { get: () => undefined } as never,
    llmReviewer: llm,
    fileTracker: { evaluate: () => undefined } as never,
  })
  return { service, sessionCache, llm, dir }
}

/** Write a resolved ask choice the way `rememberAsk` / the guard CLI does (session-long entry). */
function rememberAsk(cache: SessionLruCache, request: GuardRequest, subject: string, decision: 'allow' | 'deny', reason?: string): void {
  cache.set(buildSessionKey(request.session, request.workspace, subject), {
    decision,
    reason,
    cachedAt: Date.now(),
    expiresAt: Number.MAX_SAFE_INTEGER,
  })
}

describe('ask escape hatch: shell session memory (ADR-0019)', () => {
  it('deny-session suppresses the repeat unknown-command ask without an LLM call', async () => {
    const { service, sessionCache, llm, dir } = setup()
    try {
      const request: GuardRequest = { tool: 'bash', command: 'docker system prune -f', session: 's1', workspace: '/ws' }
      const first = await service.decide(request)
      expect(first).toMatchObject({ kind: 'ask', source: 'llm' })
      rememberAsk(sessionCache, request, 'docker system prune -f', 'deny', '本会话都不要执行 docker prune')
      const second = await service.decide(request)
      expect(second).toMatchObject({ kind: 'deny', source: 'session-cache', cached: true })
      expect(second.reason).toContain('本会话都不要执行')
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allow-session lets the repeat unknown command pass without an LLM call', async () => {
    const { service, sessionCache, llm, dir } = setup()
    try {
      const request: GuardRequest = { tool: 'bash', command: 'kind load docker-image', session: 's1', workspace: '/ws' }
      expect((await service.decide(request)).kind).toBe('ask')
      rememberAsk(sessionCache, request, 'kind load docker-image', 'allow')
      const second = await service.decide(request)
      expect(second).toMatchObject({ kind: 'allow', source: 'session-cache' })
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shell keys are normalized the same way the cache lookup normalizes them', async () => {
    const { service, sessionCache, dir } = setup()
    try {
      const request: GuardRequest = { tool: 'bash', command: 'kubectl   delete   pod demo', session: 's1', workspace: '/ws' }
      rememberAsk(sessionCache, request, 'kubectl delete pod demo', 'deny')
      const decision = await service.decide(request)
      expect(decision.source).toBe('session-cache')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ask escape hatch: file-tool session memory (ADR-0019)', () => {
  it('deny-session on the target path suppresses the repeat sensitive-path ask', async () => {
    const { service, sessionCache, llm, dir } = setup(['.env'])
    try {
      const request: GuardRequest = { tool: 'write', filePath: 'configs/.env', session: 's1', workspace: '/ws' }
      expect((await service.decide(request)).kind).toBe('ask')
      rememberAsk(sessionCache, request, 'configs/.env', 'deny', '别再写 .env，改用示例文件')
      const second = await service.decide(request)
      expect(second).toMatchObject({ kind: 'deny', source: 'session-cache', cached: true })
      expect(second.reason).toContain('.env，改用')
      expect(llm.calls).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allow-session on the target path lets the repeat write through without an ask', async () => {
    const { service, sessionCache, dir } = setup(['.env'])
    try {
      const request: GuardRequest = { tool: 'write', filePath: 'configs/.env', session: 's1', workspace: '/ws' }
      expect((await service.decide(request)).kind).toBe('ask')
      rememberAsk(sessionCache, request, 'configs/.env', 'allow')
      expect(await service.decide(request)).toMatchObject({ kind: 'allow', source: 'session-cache' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('without session memory a non-sensitive write still passes (no regression)', async () => {
    const { service, dir } = setup()
    try {
      const request: GuardRequest = { tool: 'write', filePath: 'docs/a.md', session: 's1', workspace: '/ws' }
      expect(await service.decide(request)).toMatchObject({ kind: 'allow', source: 'passthrough' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ask escape hatch: self-allowlist (ADR-0019)', () => {
  const factoryRules = () => loadRules(join(mkdtempSync(join(tmpdir(), 'ag-selfallow-')), 'missing.json'), DEFAULT_RULES_FILE)

  it('factory rules static-allow the read path and the deny-only write path', () => {
    const rules = factoryRules()
    expect(classifyCommand('auto-guard guard ask list', rules).category).toBe('static-allow')
    expect(classifyCommand('auto-guard guard ask list --json', rules).category).toBe('static-allow')
    expect(classifyCommand('auto-guard guard ask deny 1 --reason 别再问了', rules).category).toBe('static-allow')
  })

  it('never self-allows grants or the master switch', () => {
    const rules = factoryRules()
    expect(classifyCommand('auto-guard guard ask allow 1', rules).category).not.toBe('static-allow')
    expect(classifyCommand('auto-guard guard off', rules).category).not.toBe('static-allow')
    expect(classifyCommand('node evil-auto-guard.js guard ask deny 1', rules).category).not.toBe('static-allow')
  })
})
