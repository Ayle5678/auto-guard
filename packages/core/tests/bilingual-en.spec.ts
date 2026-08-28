/**
 * English golden-path assertions for the core engine surface (ADR-0011).
 * The zh fallback contract is covered by the existing Chinese-asserting
 * specs, which must keep passing byte-identical; this file pins the en side.
 */
import { describe, expect, it } from 'vitest'
import {
  applyHistoryToggle,
  applySetApi,
  optimizeListLines,
  optimizeStatusLines,
  recentLines,
  rollbackLearnedRules,
  setEnabled,
  statusLines,
} from '../src/commands.ts'
import { defaultGuardConfig } from '../src/config.ts'
import { notificationText, pageNoticeText, sourceTag } from '../src/notify.ts'
import { ASK_MEMORY_OPTIONS, askMemoryLabels, askMemoryValueOfChoice, isDenyAskValue, resolveAskMemory } from '../src/ask-memory.ts'
import type { RuntimeStatus } from '../src/decision-history.ts'
import type { Decision, GuardConfig } from '../src/types.ts'

function makeConfig(): GuardConfig {
  return defaultGuardConfig('/tmp/ag-en')
}

describe('core engine messages: en golden paths', () => {
  it('setEnabled confirms in English', () => {
    const config = makeConfig()
    expect(setEnabled(config, true, 'en')).toContain('guard enabled')
    expect(setEnabled(config, false, 'en')).toContain('guard disabled')
  })

  it('statusLines shows the effective language line, no-key warning and audit count in English', () => {
    const config = makeConfig()
    const lines = statusLines(config, {} as RuntimeStatus, '/cfg/config.json', 7, 'en')
    const joined = lines.join('\n')
    expect(joined).toContain('lang    : en')
    expect(joined).toContain('no API Key (fail-closed)')
    expect(joined).toContain('audit log records: 7')
    const failed = statusLines(config, { lastRunAt: new Date(2026, 7, 28).toISOString(), reviewerLastFailed: true } as RuntimeStatus, '/cfg', undefined, 'en')
    expect(failed.join('\n')).toContain('last LLM review failed')
  })

  it('recentLines renders the English header, layer tags and empty placeholder', () => {
    const entries: RuntimeStatus[] = [
      { lastRunAt: new Date(2026, 7, 28, 9, 0, 0).toISOString(), lastTool: 'Bash', lastCommand: 'ls', lastDecisionKind: 'allow', lastDecisionSource: 'static-allow' },
    ]
    const lines = recentLines(entries, 10, 'en')
    expect(lines[0]).toContain('Time')
    expect(lines[1]).toContain('allowlist')
    expect(recentLines([], 10, 'en')).toEqual(['(no decision history yet)'])
  })

  it('set-api and history receipts switch to English', () => {
    const config = makeConfig()
    const set = applySetApi(config, 'base', 'https://example.com', makeConfig(), 'en')
    expect(set.message).toContain('Review endpoint updated: base=https://example.com')
    const reset = applySetApi(config, 'reset', undefined, makeConfig(), 'en')
    expect(reset.message).toContain('Review endpoint reset to defaults')
    expect(applySetApi(config, 'bogus', undefined, makeConfig(), 'en').message).toContain('Usage: set set-api')
    const history = applyHistoryToggle(config, 'on', 'en')
    expect(history.messages.some((m) => m.includes('history layer enabled'))).toBe(true)
    expect(history.messages.some((m) => m.includes('examine is off'))).toBe(true)
    expect(applyHistoryToggle(config, 'sometimes', 'en').messages[0]).toBe('Usage: set history <on|off>')
  })

  it('optimize status/list/rollback switch to English', () => {
    const config = makeConfig()
    config.analyzeIntervalMinutes = 0
    const status = optimizeStatusLines(config, { version: 1, cacheable: [] }, undefined, 'en')
    const joined = status.join('\n')
    expect(joined).toContain('never')
    expect(joined).toContain('15 day(s)')
    expect(joined).toContain('most recent 5000 audit rows')
    expect(optimizeListLines({ version: 1, cacheable: [] }, 'en')).toEqual(['(no learned rules)'])
    expect(rollbackLearnedRules(config, 'en').message).toContain('No backup file available')
  })

  it('notification text carries English labels and layer tags', () => {
    const allow: Decision = { kind: 'allow', source: 'static-allow', risk: 'low', reason: 'fine' }
    expect(notificationText(allow, 'en')).toBe('[Auto Guard] ✅ allow [allowlist] (risk: low): fine')
    const deny: Decision = { kind: 'deny', source: 'session-cache', reason: 'no' }
    expect(notificationText(deny, 'en')).toBe('[Auto Guard] ⛔ deny [session cache]: no')
    const ask: Decision = { kind: 'ask', source: 'llm' }
    expect(notificationText(ask, 'en')).toBe('[Auto Guard] ❓ ask [LLM]')
    expect(sourceTag('learned', 'en')).toBe('learned rules')
    expect(sourceTag('directory-delete', 'en')).toBe('deletion review')
  })

  it('page notice text switches to English', () => {
    const decision: Decision = { kind: 'deny', source: 'history', risk: 'medium', reason: 'r' }
    expect(pageNoticeText(decision, 'en')).toBe('Auto Guard · deny · risk: medium · source: history · not sent to context')
  })
})

describe('ask-memory: value matching (ticket 02)', () => {
  it('exposes structured options with stable values and both language labels', () => {
    expect(ASK_MEMORY_OPTIONS.map((o) => o.value)).toEqual(['allow-once', 'allow-session', 'deny-once', 'deny-session'])
    expect(askMemoryLabels('zh')).toEqual(['同意（仅本次）', '本会话都同意', '拒绝（可输原因）', '本会话都拒绝（可输原因）'])
    expect(askMemoryLabels('en').every((label) => label.length > 0)).toBe(true)
  })

  it('resolves every value and both language labels to the same semantics', () => {
    for (const option of ASK_MEMORY_OPTIONS) {
      expect(askMemoryValueOfChoice(option.value)).toBe(option.value)
      expect(askMemoryValueOfChoice(option.zh)).toBe(option.value)
      expect(askMemoryValueOfChoice(option.en)).toBe(option.value)
    }
    expect(resolveAskMemory('allow-session')).toEqual({ action: 'allow', cacheWrite: { kind: 'allow' } })
    expect(resolveAskMemory('Allow (just this once)')).toEqual({ action: 'allow' })
    expect(resolveAskMemory('Deny for the rest of this session (reason optional)', 'stop')).toEqual({
      action: 'block',
      cacheWrite: { kind: 'deny', reason: 'stop' },
      reason: 'stop',
    })
  })

  it('flags exactly the two deny states and fails closed on garbage', () => {
    expect(isDenyAskValue('deny-once')).toBe(true)
    expect(isDenyAskValue('deny-session')).toBe(true)
    expect(isDenyAskValue('allow-once')).toBe(false)
    expect(isDenyAskValue('allow-session')).toBe(false)
    expect(resolveAskMemory('whatever')).toEqual({ action: 'block' })
    expect(resolveAskMemory(undefined)).toEqual({ action: 'block' })
    expect(askMemoryValueOfChoice('同意')).toBeUndefined()
  })
})
