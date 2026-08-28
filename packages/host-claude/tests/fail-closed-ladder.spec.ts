/**
 * Fail-closed ladder tests for the Claude Code PreToolUse hook (mirrors the
 * zcode ladder). From first to last:
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
import { normalizeHookInput, toGuardRequest } from '../src/claude-adapter.ts'
import { serializeHookOutput } from '../src/hook-output.ts'
import { CLAUDE_CAPABILITIES } from '../src/claude-capabilities.ts'
import { AUTO_GUARD_DIR } from '../src/config.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cl-ladder-'))
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

    const notebook = toGuardRequest(normalizeHookInput({ tool_name: 'NotebookEdit', tool_input: {} }))
    expect(notebook.kind).toBe('unreviewable')
  })

  it('passes through untracked tools silently', () => {
    const grep = toGuardRequest(normalizeHookInput({ tool_name: 'Grep', tool_input: { pattern: 'x' } }))
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
})

describe('capabilities declaration (ADR-0007)', () => {
  it('delegates ask to the host and persists session state on disk', () => {
    expect(CLAUDE_CAPABILITIES.askStyle).toBe('native')
    expect(CLAUDE_CAPABILITIES.headlessFallback).toBe('host')
    expect(CLAUDE_CAPABILITIES.hasUI).toBe(true)
    expect(CLAUDE_CAPABILITIES.sessionState).toBe('disk')
    expect(CLAUDE_CAPABILITIES.userBash).toBe(false)
    expect(CLAUDE_CAPABILITIES.notifyChannels).toEqual({ page: false, context: false })
  })
})

describe('config root isolation (ADR-0003)', () => {
  it('uses ~/.claude/auto-guard — one root per host, never shared', () => {
    expect(AUTO_GUARD_DIR.replace(/\\/g, '/')).toBe(join(homedir(), '.claude', 'auto-guard').replace(/\\/g, '/'))
  })
})
