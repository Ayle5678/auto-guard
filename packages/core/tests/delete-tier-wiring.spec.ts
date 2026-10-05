/**
 * Tiered directory-delete wiring (SPEC 0028 ticket 02): the GuardService seam
 * with a stub reviewer and real temp fixtures. Light skips the reason
 * protocol and writes the session short-TTL; standard stays byte-compatible
 * (missing policy = legacy zero-drift); strict caps an LLM allow to a human
 * confirmation; plain-file targets fall back to the normal pipeline.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GuardService } from '../src/guard-service.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { PersistentCache, SessionLruCache } from '../src/cache.ts'
import { memorySink } from '../src/persist-map.ts'
import { readDefaults } from '../src/rules.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult, RulesFile } from '../src/types.ts'
import type { LlmReviewRequest, LlmReviewer } from '../src/llm.ts'

class StubReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  constructor(private readonly result: LlmReviewResult) {}
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    return this.result
  }
}

function makeTuning(overrides: Partial<GuardTuning> = {}): GuardTuning {
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
    ...overrides,
  }
}

/** Rules shaped like a legacy install (no tiering policy) or carrying a custom one. */
function rulesWithPolicy(policy?: RulesFile['directoryDeletePolicy']): RulesFile {
  const { directoryDeletePolicy: _shipped, ...legacy } = readDefaults()
  return { ...legacy, ...(policy ? { directoryDeletePolicy: policy } : {}) }
}

function setup(options: { llm?: StubReviewer; policy?: RulesFile['directoryDeletePolicy'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-guard-tier-'))
  const llm = options.llm ?? new StubReviewer({ decision: 'allow', risk: 'low', reason: 'seems fine' })
  const store: Record<string, unknown> = {}
  const service = new GuardService({
    config: makeTuning(),
    rules: rulesWithPolicy(options.policy),
    sessionCache: new SessionLruCache(16),
    persistentCache: new PersistentCache(join(dir, 'cache.json')),
    llmReviewer: llm,
    fileTracker: new FileTracker(5 * 1000),
    pendingPersistence: { directoryDeletes: memorySink(store) },
  })
  return { service, llm, store, dir }
}

function shell(command: string, workspace: string, overrides: Partial<GuardRequest> = {}): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace, ...overrides }
}

/** A real directory under a fresh temp workspace with `files` small files. */
function workspaceWith(dir: string, files: Array<[name: string, kind: 'dir' | 'file']>): string {
  const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
  for (const [name, kind] of files) {
    if (kind === 'dir') mkdirSync(join(ws, name))
    else writeFileSync(join(ws, name), 'x')
  }
  return ws
}

/** The shipped defaults always carry the policy after SPEC 0028; the non-null shapes the tiny variants. */
const shippedPolicy = readDefaults().directoryDeletePolicy!

/** 2-file thresholds: a 3+ file tree is strict, a 2-file tree is standard (non-trivial), regenerable names stay light. */
const strictTinyPolicy: NonNullable<RulesFile['directoryDeletePolicy']> = {
  ...shippedPolicy,
  largeMinFiles: 2,
  largeMinBytes: 100,
  trivialMaxFiles: 1,
  trivialMaxBytes: 1024,
}

/** Non-trivial but not large: real small trees grade standard, so the reason protocol can be exercised. */
const standardTinyPolicy: NonNullable<RulesFile['directoryDeletePolicy']> = {
  ...shippedPolicy,
  largeMinFiles: 100,
  largeMinBytes: 500 * 1024 * 1024,
  trivialMaxFiles: 1,
  trivialMaxBytes: 1024,
}

describe('tiered delete flow: light disposition', () => {
  it('reviews rm -rf __pycache__ once with no reason protocol, then serves the session short-TTL', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'cache regenerates' })
    const { service, store, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
    const ws = workspaceWith(dir, [['__pycache__', 'dir']])
    try {
      const first = await service.decide(shell('rm -rf __pycache__', ws))
      expect(first).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(first.needsReason).toBeUndefined()
      expect(first.reason).toContain('删除分级·轻量')
      expect(llm.calls).toHaveLength(1)

      const hit = await service.decide(shell('rm -rf __pycache__', ws))
      expect(hit).toMatchObject({ kind: 'allow', source: 'session-cache', cached: true })
      expect(llm.calls).toHaveLength(1)
      expect(Object.keys(store)).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('expires the light session entry after the always-review TTL', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'cache regenerates' })
      const { service, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
      const ws = workspaceWith(dir, [['node_modules', 'dir']])
      try {
        await service.decide(shell('rm -rf node_modules', ws))
        vi.setSystemTime(30 * 60 * 1000 + 1)
        const expired = await service.decide(shell('rm -rf node_modules', ws))
        expect(expired.source).toBe('llm')
        expect(llm.calls).toHaveLength(2)
      } finally {
        rmSync(ws, { recursive: true, force: true })
        rmSync(dir, { recursive: true, force: true })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('a light compound reviews the whole command once while companions stay protocol-free', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'tmp cleanup' })
    const { service, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
    const ws = workspaceWith(dir, [['tmpdir', 'dir']])
    try {
      const d = await service.decide(shell(`cd ${ws} && rm -rf tmpdir && ls`, ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(d.needsReason).toBeUndefined()
      expect(d.reason).toContain('删除分级·轻量')
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tiered delete flow: standard disposition', () => {
  it('keeps the reason protocol for a non-trivial located tree, reviewed once at low effort', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'ok to delete' })
    const { service, store, dir } = setup({ llm, policy: standardTinyPolicy })
    const ws = workspaceWith(dir, [
      ['tree', 'dir'],
      ...Array.from({ length: 2 }, (_, i) => [`tree/f${i}`, 'file'] as [string, 'file']),
    ])
    try {
      const first = await service.decide(shell('rm -rf tree', ws))
      expect(first).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      expect(llm.calls).toHaveLength(0)
      expect(Object.keys(store)).toHaveLength(1)

      const retried = await service.decide(shell('rm -rf tree', ws, { deletionReason: 'stale build output' }))
      expect(retried).toMatchObject({ kind: 'allow', source: 'directory-delete' })
      expect(retried.reason).not.toContain('删除分级')
      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]).toMatchObject({ deletionReason: 'stale build output', reasoningEffort: 'low' })
      expect(Object.keys(store)).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a legacy install without the policy field behaves exactly as before (zero drift)', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'x' })
    const { service, llm: reviewer, dir } = setup({ llm })
    const ws = workspaceWith(dir, [['target-dir', 'dir']])
    try {
      const first = await service.decide(shell('Remove-Item ./target-dir', ws))
      expect(first).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      expect(reviewer.calls).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an unstat-able target stays standard (conservative on stat failure)', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'x' })
    const { service, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
    try {
      const d = await service.decide(shell('rm -rf ./does-not-exist', dir))
      expect(d).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      expect(llm.calls).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tiered delete flow: strict disposition', () => {
  it('caps an LLM allow to a human confirmation after the reason protocol at high effort', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'looks fine' })
    const { service, store, dir } = setup({ llm, policy: strictTinyPolicy })
    const ws = workspaceWith(dir, [
      ['big', 'dir'],
      ...Array.from({ length: 3 }, (_, i) => [`big/f${i}`, 'file'] as [string, 'file']),
    ])
    try {
      const first = await service.decide(shell('rm -rf big', ws))
      expect(first).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      expect(llm.calls).toHaveLength(0)
      expect(Object.keys(store)).toHaveLength(1)

      const capped = await service.decide(shell('rm -rf big', ws, { deletionReason: 'old build tree' }))
      expect(capped).toMatchObject({ kind: 'ask', source: 'directory-delete' })
      expect(capped.reason).toContain('人工确认')
      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]).toMatchObject({ deletionReason: 'old build tree', reasoningEffort: 'high' })
      expect(Object.keys(store)).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes a strict deny through with the strict tier marker', async () => {
    const llm = new StubReviewer({ decision: 'deny', risk: 'high', reason: 'not safe' })
    const { service, dir } = setup({ llm, policy: strictTinyPolicy })
    const ws = workspaceWith(dir, [
      ['big', 'dir'],
      ...Array.from({ length: 3 }, (_, i) => [`big/f${i}`, 'file'] as [string, 'file']),
    ])
    try {
      await service.decide(shell('rm -rf big', ws))
      const d = await service.decide(shell('rm -rf big', ws, { deletionReason: 'old build tree' }))
      expect(d).toMatchObject({ kind: 'deny', source: 'directory-delete', reason: expect.stringContaining('删除分级·严格') })
      expect(d.needsReason).toBeUndefined()
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes the strictest grade across multiple targets in one command', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'x' })
    const { service, dir } = setup({ llm, policy: strictTinyPolicy })
    const ws = workspaceWith(dir, [
      ['small', 'dir'],
      ['big', 'dir'],
      ...Array.from({ length: 3 }, (_, i) => [`big/f${i}`, 'file'] as [string, 'file']),
    ])
    try {
      const first = await service.decide(shell('rm -rf small big', ws))
      expect(first).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      const capped = await service.decide(shell('rm -rf small big', ws, { deletionReason: 'cleanup' }))
      expect(capped.kind).toBe('ask')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tiered delete flow: plain-file fallback', () => {
  it('rm -rf <file> skips the reason protocol and takes the normal review path', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'file delete ok' })
    const { service, store, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
    const ws = workspaceWith(dir, [['one.txt', 'file']])
    try {
      const d = await service.decide(shell('rm -rf one.txt', ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(d.reason).toBe('file delete ok')
      expect(d.needsReason).toBeUndefined()
      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]?.deletionReason).toBeUndefined()
      expect(Object.keys(store)).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rm -rf .env lands on the sensitive-path demotion before anything else', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'reviewed' })
    const { service, store, dir } = setup({ llm, policy: readDefaults().directoryDeletePolicy })
    const ws = workspaceWith(dir, [['.env', 'file']])
    try {
      const d = await service.decide(shell('rm -rf .env', ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(d.needsReason).toBeUndefined()
      expect(llm.calls).toHaveLength(1)
      expect(Object.keys(store)).toHaveLength(0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tiered delete flow: wrapped Remove-Item retry (SPEC 0028 B2 e2e)', () => {
  it('a powershell-wrapped Remove-Item first hit records its targets, and a bare rm retry with a reason matches them', async () => {
    const llm = new StubReviewer({ decision: 'allow', risk: 'low', reason: 'ok' })
    const { service, dir } = setup({ llm, policy: standardTinyPolicy })
    const ws = workspaceWith(dir, [
      ['miniforge3_old', 'dir'],
      ...Array.from({ length: 2 }, (_, i) => [`miniforge3_old/f${i}`, 'file'] as [string, 'file']),
    ])
    try {
      const first = await service.decide(
        shell(`powershell -NoProfile -Command "Remove-Item '${join(ws, 'miniforge3_old')}' -Recurse -Force"`, ws),
      )
      expect(first).toMatchObject({ kind: 'deny', source: 'directory-delete', needsReason: true })
      expect(llm.calls).toHaveLength(0)

      const retry = await service.decide(shell(`rm -rf '${join(ws, 'miniforge3_old')}' [删除理由] stale conda env`, ws))
      // The neighbor match lands: one review, never a second reason demand.
      expect(retry).toMatchObject({ kind: 'allow', source: 'directory-delete' })
      expect(retry.needsReason).toBeUndefined()
      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]?.deletionReason).toBe('stale conda env')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
