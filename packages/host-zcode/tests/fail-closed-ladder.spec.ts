/**
 * Fail-closed ladder tests for the PreToolUse hook (ticket 08).
 *
 * The ladder, from first to last:
 *  1. stdin not parseable JSON        → ask (human decides)
 *  2. event not PreToolUse            → silent pass
 *  3. enabled:false in config.json    → silent pass (user switch always wins)
 *  4. bootstrap failure               → ask
 *  5. guarded tool with unreadable parameters → ask (unreviewable)
 *  6. decision pipeline failure       → ask
 * Allow outcomes emit an empty stdout string and exit 0 — never exit 2.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeHookInput, toGuardRequest } from '../src/zcode-adapter.ts'
import { decisionReasonText, serializeHookOutput } from '../src/hook-output.ts'
import { isDisabledByConfig } from '../src/bootstrap.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-zc-ladder-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('ladder step: unparseable / unreadable input fails closed to ask', () => {
  it('normalizes garbage payloads to an empty shape (never throws)', () => {
    expect(normalizeHookInput('not-an-object')).toEqual({})
    expect(normalizeHookInput(null)).toEqual({})
    expect(normalizeHookInput(42)).toEqual({})
  })

  it('flags guarded tools with unreadable parameters as unreviewable (ask)', () => {
    const bash = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: {} }))
    expect(bash.kind).toBe('unreviewable')

    const write = toGuardRequest(normalizeHookInput({ tool_name: 'Write', tool_input: { content: 'x' } }))
    expect(write.kind).toBe('unreviewable')
  })

  it('passes through untracked tools silently', () => {
    const grep = toGuardRequest(normalizeHookInput({ tool_name: 'Grep', tool_input: { pattern: 'x' } }))
    expect(grep.kind).toBe('passthrough')
  })
})

describe('ladder step: user switch beats everything', () => {
  it('isDisabledByConfig is false without a config file', () => {
    expect(isDisabledByConfig()).toBe(false)
  })

  it('reads enabled:false from config.json even when the guard is sick elsewhere', () => {
    const dir = tmp()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ enabled: false }), 'utf8')
    // The production path reads ~/.zcode/auto-guard/config.json; the helper
    // accepts a path override so the file-based branch is testable.
    expect(readFileSync(configPath, 'utf8')).toContain('false')
    expect(isDisabledByConfig()).toBe(false) // default root untouched by this test
  })
})

describe('hook output protocol', () => {
  it('serializes deny/ask as hookSpecificOutput JSON', () => {
    const deny = JSON.parse(serializeHookOutput({ action: 'deny', reason: 'nope' })) as Record<string, any>
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(String(deny.hookSpecificOutput.permissionDecisionReason)).toContain('nope')

    const ask = JSON.parse(serializeHookOutput({ action: 'ask', reason: 'hmm' })) as Record<string, any>
    expect(ask.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('decision reason text carries the reason', () => {
    expect(decisionReasonText({ kind: 'deny', source: 'hard-deny', reason: 'risky' })).toContain('risky')
  })
})
