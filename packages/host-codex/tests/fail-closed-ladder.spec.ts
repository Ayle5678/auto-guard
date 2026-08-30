/**
 * Fail-closed ladder tests for the codex PreToolUse hook (SPEC 0015).
 *
 * The ladder, from first to last:
 *  1. stdin not parseable JSON        → deny (ask would fail-open on codex)
 *  2. event not PreToolUse            → silent pass
 *  3. enabled:false in config.json    → silent pass (user switch always wins)
 *  4. guarded tool with unreadable parameters → deny (unreviewable)
 *  5. patch surface without a usable patch text  → deny (unreviewable)
 * Allow outcomes emit an empty stdout string and exit 0 — never exit 2.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeHookInput, toGuardRequest } from '../src/codex-adapter.ts'
import { codexWire, decisionReasonText, serializeHookOutput } from '../src/hook-output.ts'
import { isDisabledByConfig } from '../src/bootstrap.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cx-ladder-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('ladder step: unparseable / unreadable input fails closed', () => {
  it('normalizes garbage payloads to an empty shape (never throws)', () => {
    expect(normalizeHookInput('not-an-object')).toEqual({})
    expect(normalizeHookInput(null)).toEqual({})
    expect(normalizeHookInput(42)).toEqual({})
  })

  it('flags guarded tools with unreadable parameters as unreviewable', () => {
    const bash = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: {} }))
    expect(bash.kind).toBe('unreviewable')

    const patch = toGuardRequest(normalizeHookInput({ tool_name: 'apply_patch', tool_input: {} }))
    expect(patch.kind).toBe('unreviewable')
  })

  it('passes through untracked tools silently', () => {
    const grep = toGuardRequest(normalizeHookInput({ tool_name: 'update_plan', tool_input: { plan: [] } }))
    expect(grep.kind).toBe('passthrough')
  })
})

describe('ladder step: user switch beats everything', () => {
  it('isDisabledByConfig is false without a config file', () => {
    expect(isDisabledByConfig()).toBe(false)
  })
})

describe('hook output protocol', () => {
  it('serializes deny as hookSpecificOutput JSON and ask as deny (codex fallback)', () => {
    const deny = JSON.parse(serializeHookOutput({ action: 'deny', reason: 'nope' })) as Record<string, { permissionDecision: string }>
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')

    const ask = JSON.parse(codexWire.serialize({ action: 'ask', reason: 'hmm' }, 'zh')) as { hookSpecificOutput: { permissionDecision: string } }
    expect(ask.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('decision reason text carries the reason', () => {
    expect(decisionReasonText({ kind: 'deny', source: 'hard-deny', reason: 'risky' })).toContain('risky')
  })
})
