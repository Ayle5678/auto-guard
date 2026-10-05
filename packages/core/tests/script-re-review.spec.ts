/**
 * Script attach-recheck (SPEC 0027 ticket 03) at the GuardService seam: a
 * first deny/ask on the plain review path re-reviews exactly once with the
 * in-limit script text attached; the recheck verdict is final with the normal
 * cache write-back. Allow, reviewer failure, over-limit, unresolvable and
 * excluded paths never trigger a second call.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GuardService } from '../src/guard-service.ts'
import { FileTracker } from '../src/file-tracker.ts'
import { PersistentCache, SessionLruCache, buildWorkspaceKey } from '../src/cache.ts'
import { readDefaults } from '../src/rules.ts'
import type { GuardRequest, GuardTuning, LlmReviewResult } from '../src/types.ts'
import type { LlmReviewRequest, LlmReviewer } from '../src/llm.ts'

/** Reviewer with one result per call, so first review and recheck can disagree. */
class ScriptedReviewer implements LlmReviewer {
  calls: LlmReviewRequest[] = []
  constructor(private readonly results: LlmReviewResult[], private readonly throwError?: Error) {}
  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    this.calls.push(request)
    if (this.throwError && this.calls.length === 1) throw this.throwError
    return this.results[Math.min(this.calls.length - 1, this.results.length - 1)]!
  }
}

function setup(llm: LlmReviewer) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-guard-srr-'))
  const tuning: GuardTuning = {
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    alwaysReviewCacheTtlMinutes: 30,
    onTimeout: 'ask',
    fileTrackerDefault: 'ask',
    historyEnabled: false,
    examineEnabled: false,
    historyMinTotal: 4,
    historyMinLlm: 1,
  }
  const sessionCache = new SessionLruCache(16)
  const persistentCache = new PersistentCache(join(dir, 'cache.json'))
  const fileTracker = new FileTracker(5 * 1000)
  const service = new GuardService({
    config: tuning,
    rules: readDefaults(),
    sessionCache,
    persistentCache,
    llmReviewer: llm,
    fileTracker,
  })
  return { service, sessionCache, persistentCache, fileTracker, dir }
}

function shell(command: string, workspace: string, overrides: Partial<GuardRequest> = {}): GuardRequest {
  return { tool: 'bash', command, session: 's1', workspace, ...overrides }
}

describe('script attach-recheck', () => {
  it('re-reviews a denied interpreter+script once with the text attached; the allow is final and cached', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([
      { decision: 'deny', risk: 'medium', reason: 'script content unknown' },
      { decision: 'allow', risk: 'low', reason: 'script is a plain logger' },
    ])
    const { service, persistentCache, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'sync.mjs'), "console.log('hello')\n")
      const d = await service.decide(shell('node sync.mjs', ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(d.reason).toContain('经脚本附审复审')
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls[1]!.script).toBe("console.log('hello')\n")
      expect(llm.calls[1]!.command).toBe('node sync.mjs')
      // Normal write-back for an unknown-category allow.
      expect(persistentCache.get(buildWorkspaceKey(ws, 'node sync.mjs'))).toMatchObject({ decision: 'allow' })
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an ask can re-review into a final deny', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([
      { decision: 'ask', risk: 'low', reason: 'unknown content' },
      { decision: 'deny', risk: 'high', reason: 'script wipes the home dir' },
    ])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'x.py'), 'import shutil\n')
      const d = await service.decide(shell('python x.py', ws))
      expect(d).toMatchObject({ kind: 'deny', source: 'llm' })
      expect(llm.calls).toHaveLength(2)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a first allow never triggers a second call', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'allow', risk: 'low', reason: 'fine' }])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'a.js'), 'console.log(1)\n')
      await service.decide(shell('node a.js', ws))
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a reviewer failure on the first review never triggers a second call', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'allow', risk: 'low', reason: 'unused' }], new Error('timeout'))
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'a.js'), 'console.log(1)\n')
      const d = await service.decide(shell('node a.js', ws))
      expect(d).toMatchObject({ kind: 'ask', reviewerFailed: true })
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the first verdict when the script exceeds a limit or is binary', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'ask', risk: 'low', reason: 'content unknown' }])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'long.js'), `${Array.from({ length: 101 }, (_, i) => `// line ${i}`).join('\n')}\n`)
      writeFileSync(join(ws, 'bin.py'), Buffer.from('import os\n' + '\u0000'.repeat(32), 'latin1'))
      const long = await service.decide(shell('node long.js', ws))
      expect(long.kind).toBe('ask')
      expect(long.reviewerFailed).toBeUndefined()
      const binary = await service.decide(shell('python bin.py', ws))
      expect(binary.kind).toBe('ask')
      expect(llm.calls).toHaveLength(2)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips $VAR paths and non-existent scripts', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'ask', risk: 'low', reason: 'content unknown' }])
    const { service, dir } = setup(llm)
    try {
      const variable = await service.decide(shell('node $TMP/x.js', ws))
      const missing = await service.decide(shell('node missing.js', ws))
      expect(variable.kind).toBe('ask')
      expect(missing.kind).toBe('ask')
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls.every((call) => call.script === undefined)).toBe(true)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a relative script through the compound leading cd segment', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([
      { decision: 'deny', risk: 'medium', reason: 'content unknown' },
      { decision: 'allow', risk: 'low', reason: 'harmless render script' },
    ])
    const { service, dir } = setup(llm)
    try {
      mkdirSync(join(ws, 'sub'))
      writeFileSync(join(ws, 'sub', 'run.mjs'), 'await import("node:fs")\n')
      const d = await service.decide(shell('cd sub && node run.mjs', ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(d.reason).toContain('经脚本附审复审')
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls[1]!.script).toBe('await import("node:fs")\n')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('attaches scripts from any location, including the OS temp dir', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const temp = mkdtempSync(join(tmpdir(), 'pi-guard-srr-t-'))
    const llm = new ScriptedReviewer([
      { decision: 'ask', risk: 'medium', reason: 'content unknown' },
      { decision: 'allow', risk: 'low', reason: 'one-off probe' },
    ])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(temp, 'accept-9.mjs'), 'console.log("ok")\n')
      const d = await service.decide(shell(`node ${join(temp, 'accept-9.mjs').replace(/\\/g, '/')}`, ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls[1]!.script).toBe('console.log("ok")\n')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(temp, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips unresolvable interpreter segments and attaches the first parseable script', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([
      { decision: 'deny', risk: 'medium', reason: 'content unknown' },
      { decision: 'allow', risk: 'low', reason: 'resolvable one is fine' },
    ])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'second.js'), 'console.log(2)\n')
      // A high-risk segment forces whole-compound review as one unit; the
      // first interpreter segment cannot resolve ($VAR), the second does.
      // (In the per-segment loop a first-segment deny is the compound verdict
      // before any second segment is ever reviewed — different flow.)
      const d = await service.decide(shell('export BUILD=1 && node $TMP/missing.mjs && node second.js', ws))
      expect(d).toMatchObject({ kind: 'allow', source: 'llm' })
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls[1]!.script).toBe('console.log(2)\n')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never attaches on the sensitive-path demotion (content discipline)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'deny', risk: 'high', reason: 'sensitive' }])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, '.env'), 'SECRET=1\n')
      const d = await service.decide(shell('node .env', ws))
      expect(d).toMatchObject({ kind: 'deny', source: 'llm' })
      expect(llm.calls).toHaveLength(1)
      expect(llm.calls[0]!.script).toBeUndefined()
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('write-then-execute already carries the script — no recheck', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([
      { decision: 'allow', risk: 'low', reason: 'write ok' },
      { decision: 'deny', risk: 'low', reason: 'tracked script denied' },
    ])
    const { service, fileTracker, dir } = setup(llm)
    try {
      const script = join(ws, 'run.sh').replace(/\\/g, '/')
      writeFileSync(join(ws, 'run.sh'), 'echo hi\n')
      await service.decide(shell(`echo 'echo hi' > ${script}`, ws))
      expect(fileTracker.evaluate(`bash ${script}`)).not.toBeNull()
      const d = await service.decide(shell(`bash ${script}`, ws))
      expect(d).toMatchObject({ kind: 'deny', source: 'file-tracker' })
      expect(llm.calls).toHaveLength(2)
      expect(llm.calls[1]!.script).toBe('echo hi\n')
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('only interpreters from the rules field attach', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pi-guard-ws-'))
    const llm = new ScriptedReviewer([{ decision: 'ask', risk: 'low', reason: 'unknown' }])
    const { service, dir } = setup(llm)
    try {
      writeFileSync(join(ws, 'x.rb'), 'puts 1\n')
      const d = await service.decide(shell('ruby x.rb', ws))
      expect(d.kind).toBe('ask')
      expect(llm.calls).toHaveLength(1)
    } finally {
      rmSync(ws, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
