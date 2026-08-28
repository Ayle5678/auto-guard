/**
 * Review-prompt language instruction (ADR-0011): en appends a fixed
 * reason-language suffix; zh keeps the historical prompt byte-identical so
 * existing prompt-cache prefixes stay valid.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekReviewer, REVIEW_SYSTEM_PROMPT, reviewSystemPrompt } from '../src/llm.ts'
import type { GuardConfig } from '../src/types.ts'

function makeConfig(lang?: 'zh' | 'en'): GuardConfig {
  return {
    enabled: true,
    ...(lang ? { lang } : {}),
    rulesPath: 'x',
    defaultRulesPath: 'x',
    cachePath: 'x',
    apiBase: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: '',
    model: 'm',
    fallbackModel: 'm',
    timeoutMs: 3000,
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    onTimeout: 'deny',
    headlessMode: 'deny',
    notifyCacheHit: true,
    notifyLlmDecision: true,
    notifyAllow: 'page',
    notifyDeny: 'context',
    notifyAsk: 'context',
    fileTrackerDefault: 'ask',
    fileTrackerWindowSec: 5,
    sessionCacheSize: 256,
    alwaysReviewCacheTtlMinutes: 30,
    examineEnabled: false,
    auditDbPath: 'x',
    historyEnabled: false,
    autoAnalyzeEnabled: false,
    historyDays: 60,
    historyMinTotal: 4,
    historyMinLlm: 1,
    learnedCacheableMinTotal: 8,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    templateCachePath: 'x',
    learnedRulesPath: 'x',
    learnedBackupPath: 'x',
    analyzeStatePath: 'x',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DEEPSEEK_API_KEY
})

describe('reviewSystemPrompt', () => {
  it('zh is the unchanged base prompt', () => {
    expect(reviewSystemPrompt('zh')).toBe(REVIEW_SYSTEM_PROMPT)
  })

  it('en appends the reason-language instruction while keeping the base prefix stable', () => {
    const en = reviewSystemPrompt('en')
    expect(en.startsWith(REVIEW_SYSTEM_PROMPT)).toBe(true)
    expect(en).toContain('Write "reason" in English.')
    expect(en).toContain('strict JSON')
  })
})

describe('DeepSeekReviewer: language follows the config', () => {
  it('sends the en system prompt when config.lang is en', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{"decision":"allow","risk":"low","reason":"ok"}' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await new DeepSeekReviewer(makeConfig('en')).review({ command: 'ls' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]!.content).toBe(reviewSystemPrompt('en'))

    await new DeepSeekReviewer(makeConfig('zh')).review({ command: 'ls' })
    const [, zhInit] = fetchMock.mock.calls[1] as unknown as [string, { body: string }]
    const zhBody = JSON.parse(zhInit.body) as { messages: Array<{ role: string; content: string }> }
    expect(zhBody.messages[0]!.content).toBe(REVIEW_SYSTEM_PROMPT)
  })

  it('an explicit constructor lang wins over the config field (machine-default layer)', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{"decision":"allow","risk":"low","reason":"ok"}' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await new DeepSeekReviewer(makeConfig(), 'en').review({ command: 'ls' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]!.content).toBe(reviewSystemPrompt('en'))
  })
})
