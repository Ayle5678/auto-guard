/**
 * `guard ask` escape hatch end-to-end on the real zcode descriptor
 * (ADR-0019): hook asks on a sensitive write → CLI resolves deny-session with
 * a reason → the SAME call now lands as a deny carrying that reason, without
 * any LLM round-trip in between.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listPendingAsks, sidHash } from '@auto-guard/core'
import { createHookHost, type HookHost } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from '../src/descriptor.ts'

const PROBE = 'escape-e2e-probe/.env'

function writePayload(probe = PROBE): string {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: probe, content: 'A=1' }, session_id: 'sess-e2e', cwd: process.cwd() })
}

function specificOf(stdoutLine: string): { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } {
  return (JSON.parse(stdoutLine) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput ?? {}
}

describe('guard ask end-to-end (zcode)', () => {
  let dir = ''
  let host: HookHost

  async function runHook(probe = PROBE): Promise<string[]> {
    const stdout: string[] = []
    await host.hookMain({
      stdin: writePayload(probe),
      writeOut: (text) => stdout.push(text),
      exit: (code) => {
        if (code) throw new Error(`hook exit ${code}`)
      },
      spawnAnalysis: () => undefined,
    })
    return stdout
  }

  async function cli(argv: readonly string[]): Promise<{ out: string; code: number }> {
    const chunks: string[] = []
    const original = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stdout.write
    try {
      const code = await host.cliMain(argv)
      return { out: chunks.join(''), code }
    } finally {
      process.stdout.write = original
    }
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ag-zcode-ask-'))
    host = createHookHost(ZCODE_DESCRIPTOR, { home: dir, spawnAnalysis: () => undefined })
  })

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // Windows WAL handles; the OS temp cleaner wins.
    }
  })

  it('walks ask → CLI deny --reason → same call denies with that reason', async () => {
    // Fresh home: nothing pending.
    expect((await cli(['guard', 'ask', 'list'])).out).toContain('没有待裁决的 ask')

    // The sensitive write asks, carries the escape hint and the model pre-brief,
    // and leaves exactly one resolvable record.
    const first = (await runHook())[0]
    const asked = specificOf(first)
    expect(asked.permissionDecision).toBe('ask')
    expect(asked.permissionDecisionReason).toContain('guard ask')
    expect(asked.additionalContext).toContain('auto-guard')

    const sessionsDir = join(dir, '.zcode', 'auto-guard', 'sessions')
    const records = listPendingAsks(sessionsDir).filter((entry) => entry.record.command === PROBE)
    expect(records).toHaveLength(1)

    // Resolve deny-session with a user reason (index = position in the list).
    const index = listPendingAsks(sessionsDir).findIndex((entry) => entry.record.command === PROBE) + 1
    const resolved = await cli(['guard', 'ask', 'deny', String(index), '--reason', '别再写 .env，改用示例文件'])
    expect(resolved.code).toBe(0)
    expect(resolved.out).toContain('已记入本会话拒绝')
    expect(resolved.out).toContain('别再写 .env，改用示例文件')

    // The identical call is now denied from session memory with that reason —
    // no host prompt, no additionalContext on denies.
    const second = specificOf((await runHook())[0])
    expect(second.permissionDecision).toBe('deny')
    expect(second.permissionDecisionReason).toContain('别再写 .env，改用示例文件')
    expect(second.additionalContext).toBeUndefined()
  })

  it('keeps the ask byte-compatible when the record cannot land (silent side note)', async () => {
    // Force the pending-ask write to fail: pending-asks.json exists as a
    // DIRECTORY, so every sink read/write throws. Pin the session dir by
    // clearing the env session chain for the duration of the test.
    const saved = Object.entries(process.env).filter(([k]) => ['ZCODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID'].includes(k))
    for (const [k] of saved) delete process.env[k]
    try {
      const { mkdirSync, rmSync } = await import('node:fs')
      const sidDir = join(dir, '.zcode', 'auto-guard', 'sessions', sidHash('<no-session>'))
      // Earlier tests in this home may have created it as a FILE — replace with a directory.
      rmSync(join(sidDir, 'pending-asks.json'), { force: true })
      mkdirSync(join(sidDir, 'pending-asks.json'), { recursive: true })
      try {
        const stdout = await runHook('escape-silent-probe/.env')
        const specific = specificOf(stdout[0])
        expect(specific.permissionDecision).toBe('ask')
        // The record could not land → no hint, no pre-brief; the ask still goes out.
        expect(specific.permissionDecisionReason).not.toContain('guard ask')
        expect(specific.additionalContext).toBeUndefined()
      } finally {
        rmSync(join(sidDir, 'pending-asks.json'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
    }
  })
})
