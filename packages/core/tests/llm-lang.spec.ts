/**
 * Review-prompt language instruction (ADR-0011 / ADR-0020): en appends a fixed
 * reason-language suffix to the compact verdict-code base prompt.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DeepSeekReviewer, REVIEW_SYSTEM_PROMPT, reviewSystemPrompt } from '../src/llm.ts'
import { chatOk, startChatMock, type ChatMock } from './helpers/chat-mock.ts'
import type { GuardConfig } from '../src/types.ts'

function makeConfig(lang?: 'zh' | 'en', apiBase = 'https://api.deepseek.com'): GuardConfig {
  return {
    enabled: true,
    ...(lang ? { lang } : {}),
    rulesPath: 'x',
    defaultRulesPath: 'x',
    cachePath: 'x',
    apiBase,
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

const openMocks: ChatMock[] = []

async function startMock(): Promise<ChatMock> {
  const mock = await startChatMock()
  openMocks.push(mock)
  mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
  return mock
}

afterEach(async () => {
  await Promise.allSettled(openMocks.splice(0).map((mock) => mock.close()))
  delete process.env.DEEPSEEK_API_KEY
})

describe('reviewSystemPrompt', () => {
  it('zh is the unchanged base prompt', () => {
    expect(reviewSystemPrompt('zh')).toBe(REVIEW_SYSTEM_PROMPT)
  })

  it('en appends the reason-language instruction while keeping the base prefix stable', () => {
    const en = reviewSystemPrompt('en')
    expect(en.startsWith(REVIEW_SYSTEM_PROMPT)).toBe(true)
    expect(en).toContain('Write the deny/ask reason in English.')
    expect(REVIEW_SYSTEM_PROMPT).toContain('verdict code')
  })

  // Intentional snapshot (SPEC 0027 A1): the calibrated ask rule. Any byte
  // change here is a deliberate prompt revision — flip this pin with it.
  it('pins the calibrated ask rule and leaves every other rule line untouched', () => {
    const calibratedAsk = [
      '  - "ask": ONLY when both allow and deny are clearly wrong — e.g. an',
      '    irreversible action whose blast radius you cannot bound from the command',
      '    text alone. Running project scripts, killing processes the agent started,',
      '    cleaning up temp files it created, curling localhost, and other routine',
      '    agent dev-loop operations are "allow". Judge multi-line commands and',
      '    for-loops as a whole; a present loop body is not "incomplete". When merely',
      '    uncertain between allow and ask, choose allow with the higher risk digit.',
    ].join('\n')
    expect(REVIEW_SYSTEM_PROMPT).toContain(calibratedAsk)
    expect(reviewSystemPrompt('zh')).toContain(calibratedAsk)
    expect(reviewSystemPrompt('en')).toContain(calibratedAsk)
    expect(REVIEW_SYSTEM_PROMPT).not.toContain('prefer ask over allow')
    // Every line outside the ask rule is byte-identical to the pre-calibration
    // contract (ADR-0020 verdict-code lines carry over untouched).
    for (const line of [
      'You are a command-safety reviewer for a full-access agent.',
      '  - "allow": safe/typical development command. Reply with the code alone, e.g. A1.',
      '  - "deny": destructive, dangerous, credential-exposing, or clearly malicious command.',
      '  - Risk reflects blast radius.',
      '  - Never output anything besides the code (or code + reason). No markdown fences.',
    ]) {
      expect(REVIEW_SYSTEM_PROMPT).toContain(line)
    }
  })
})

describe('DeepSeekReviewer: language follows the config', () => {
  it('sends the en system prompt when config.lang is en', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    await new DeepSeekReviewer(makeConfig('en', mock.apiBase)).review({ command: 'ls' })
    const enBody = JSON.parse(mock.requests[0]!.body) as { messages: Array<{ role: string; content: string }> }
    expect(enBody.messages[0]!.content).toBe(reviewSystemPrompt('en'))

    await new DeepSeekReviewer(makeConfig('zh', mock.apiBase)).review({ command: 'ls' })
    const zhBody = JSON.parse(mock.requests[1]!.body) as { messages: Array<{ role: string; content: string }> }
    expect(zhBody.messages[0]!.content).toBe(REVIEW_SYSTEM_PROMPT)
  })

  it('an explicit constructor lang wins over the config field (machine-default layer)', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    await new DeepSeekReviewer(makeConfig(undefined, mock.apiBase), 'en').review({ command: 'ls' })
    const body = JSON.parse(mock.requests[0]!.body) as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]!.content).toBe(reviewSystemPrompt('en'))
  })
})
