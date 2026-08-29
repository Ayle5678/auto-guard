/**
 * Fail-closed ladder tests for the Qoder PreToolUse hook (mirrors the claude
 * ladder). From first to last:
 *  1. stdin not parseable JSON        → ask (native confirmation box decides)
 *  2. event not PreToolUse            → silent pass
 *  3. enabled:false in config.json    → silent pass (user switch always wins)
 *  4. bootstrap failure               → ask
 *  5. guarded tool with unreadable parameters → ask (unreviewable)
 *  6. decision pipeline failure       → ask
 * Allow outcomes emit an empty stdout string and exit 0 — never exit 2.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeHookInput, toGuardRequest } from '../src/qoder-adapter.ts'
import { serializeHookOutput } from '../src/hook-output.ts'
import { QODER_CAPABILITIES } from '../src/qoder-capabilities.ts'
import { AUTO_GUARD_DIR } from '../src/config.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-qd-ladder-'))
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

    const write = toGuardRequest(normalizeHookInput({ tool_name: 'create_file', tool_input: { content: 'x' } }))
    expect(write.kind).toBe('unreviewable')
  })

  it('passes through untracked tools silently', () => {
    const grep = toGuardRequest(normalizeHookInput({ tool_name: 'grep_code', tool_input: { pattern: 'x' } }))
    expect(grep.kind).toBe('passthrough')
  })
})

describe('ladder step: guard unavailable lands on the native ask', () => {
  it('serializes unreviewable/guard-failure outcomes as permissionDecision ask', () => {
    const parsed = JSON.parse(serializeHookOutput({ action: 'ask', reason: 'auto-guard 初始化失败' })) as never as {
      hookSpecificOutput: { permissionDecision: string }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('never uses exit code 2 semantics: deny also travels as JSON', () => {
    const parsed = JSON.parse(serializeHookOutput({ action: 'deny', reason: '危险' })) as never as {
      hookSpecificOutput: { permissionDecision: string }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('crash catch-all is ask, not deny: a sick guard hands the call to the human', () => {
    // Mirrors the claude/zcode precedent: crash → ask means the native
    // confirmation box decides; a deny-level catch-all would hard-block
    // everything while the guard itself is broken.
    const parsed = JSON.parse(serializeHookOutput({ action: 'ask', reason: 'auto-guard 未捕获异常：boom；保守起见需要人工确认' })) as never as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
    }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('未捕获异常')
  })
})

describe('capabilities declaration (ADR-0007)', () => {
  it('delegates ask to the host and persists session state on disk', () => {
    expect(QODER_CAPABILITIES.askStyle).toBe('native')
    expect(QODER_CAPABILITIES.headlessFallback).toBe('host')
    expect(QODER_CAPABILITIES.hasUI).toBe(true)
    expect(QODER_CAPABILITIES.sessionState).toBe('disk')
    expect(QODER_CAPABILITIES.userBash).toBe(false)
    expect(QODER_CAPABILITIES.notifyChannels).toEqual({ page: false, context: false })
  })
})

describe('config root isolation (ADR-0003)', () => {
  it('uses ~/.qoder/auto-guard — one root per host, never shared', () => {
    expect(AUTO_GUARD_DIR.replace(/\\/g, '/')).toBe(join(homedir(), '.qoder', 'auto-guard').replace(/\\/g, '/'))
  })
})
