import { afterEach, describe, expect, it } from 'vitest'
import { DeepSeekReviewer, reviewTimeoutBudget } from '../src/llm.ts'
import { chatOk, startChatMock, type ChatMock } from './helpers/chat-mock.ts'
import type { GuardConfig, LlmReviewResult } from '../src/types.ts'

function makeConfig(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return {
    enabled: true,
    rulesPath: 'x',
    defaultRulesPath: 'x',
    cachePath: 'x',
    apiBase: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: '',
    model: 'deepseek-v4-flash',
    fallbackModel: 'deepseek-chat',
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
    auditDbPath: '~/.pi/auto-guard/audit.db',
    historyEnabled: false,
    autoAnalyzeEnabled: false,
    historyDays: 60,
    historyMinTotal: 4,
    historyMinLlm: 1,
    learnedCacheableMinTotal: 8,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    templateCachePath: "x/template-cache.json",
    learnedRulesPath: '~/.pi/auto-guard/learned-rules.json',
    learnedBackupPath: '~/.pi/auto-guard/learned-rules.backup.json',
    analyzeStatePath: '~/.pi/auto-guard/analyze-state.json',
    ...overrides,
  }
}

const openMocks: ChatMock[] = []

async function startMock(): Promise<ChatMock> {
  const mock = await startChatMock()
  openMocks.push(mock)
  return mock
}

afterEach(async () => {
  await Promise.allSettled(openMocks.splice(0).map((mock) => mock.close()))
  delete process.env.DEEPSEEK_API_KEY
})

describe('DeepSeekReviewer: request', () => {
  it('POSTs to /chat/completions with a Bearer token from env and the configured model', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    await reviewer.review({ command: 'ls', reasoningEffort: 'off' })

    expect(mock.requests).toHaveLength(1)
    const [req] = mock.requests
    expect(req.path).toBe('/chat/completions')
    expect(req.headers.authorization).toBe('Bearer secret')
    const body = JSON.parse(req.body)
    expect(body.model).toBe('deepseek-v4-flash')
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('sends the deletion reason as a user message when present', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    await reviewer.review({ command: 'rm -rf ./dist', deletionReason: '清理构建产物', reasoningEffort: 'high' })

    const body = JSON.parse(mock.requests[0]!.body)
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMsg.content).toContain('清理构建产物')
  })
})

describe('DeepSeekReviewer: response handling', () => {
  it('parses a strict JSON review', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"deny","risk":"high","reason":"danger"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))
    const result = await reviewer.review({ command: 'rm -rf /' })
    expect(result).toEqual({ decision: 'deny', risk: 'high', reason: 'danger' } satisfies LlmReviewResult)
  })

  it('parses JSON embedded in markdown fences', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('```json\n{"decision":"ask","risk":"medium","reason":"?"}\n```'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))
    const result = await reviewer.review({ command: 'weird' })
    expect(result).toMatchObject({ decision: 'ask', risk: 'medium' })
  })

  it('throws when the response is not ok', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond((_req, res) => {
      res.statusCode = 500
      res.statusMessage = 'Server Error'
      res.end('Server Error')
    })
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))
    await expect(reviewer.review({ command: 'x' })).rejects.toThrow('LLM review failed: 500 Server Error')
  })

  it('throws when the content is not valid review JSON', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('not json'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))
    await expect(reviewer.review({ command: 'x' })).rejects.toThrow('Invalid LLM review response')
  })

  it('retries with the fallback model on a 400 model error', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond((_req, res) => {
      if (mock.requests.length === 1) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: { message: 'model does not exist' } }))
        return
      }
      chatOk('{"decision":"allow","risk":"low","reason":"ok"}')(_req, res)
    })
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))
    const result = await reviewer.review({ command: 'x' })
    expect(result).toMatchObject({ decision: 'allow' })
    expect(mock.requests).toHaveLength(2)
    expect(JSON.parse(mock.requests[1]!.body).model).toBe('deepseek-chat')
  })

  it('throws on timeout (AbortError)', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    // Never-ending response: the 1ms socket budget is what ends the request.
    mock.respond(() => {})
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase, timeoutMs: 1 }))
    await expect(reviewer.review({ command: 'x' })).rejects.toThrow('LLM review timed out')
  })
})

describe('DeepSeekReviewer: api key resolution', () => {
  it('uses the stored config key when no env var is set', async () => {
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase, apiKey: 'stored-key' }))

    await reviewer.review({ command: 'ls' })

    expect(mock.requests[0]!.headers.authorization).toBe('Bearer stored-key')
  })

  it('prefers the env var over the stored key', async () => {
    process.env.DEEPSEEK_API_KEY = 'env-key'
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase, apiKey: 'stored-key' }))

    await reviewer.review({ command: 'ls' })

    expect(mock.requests[0]!.headers.authorization).toBe('Bearer env-key')
  })

  it('throws and records a failed lastReview when no key is available', async () => {
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    await expect(reviewer.review({ command: 'x' })).rejects.toThrow('missing DEEPSEEK_API_KEY')

    expect(mock.requests).toHaveLength(0)
    expect(reviewer.lastReview?.ok).toBe(false)
    expect(reviewer.lastReview?.error).toBe('missing DEEPSEEK_API_KEY')
  })

  it('records a successful lastReview after a good call', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('{"decision":"allow","risk":"low","reason":"ok"}'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    await reviewer.review({ command: 'ls' })

    expect(reviewer.lastReview?.ok).toBe(true)
  })
})

describe('DeepSeekReviewer: ping', () => {
  it('returns ok when the API replies', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond(chatOk('pong'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    const result = await reviewer.ping()

    expect(result.ok).toBe(true)
    expect(mock.requests).toHaveLength(1)
    const [req] = mock.requests
    expect(req.path).toBe('/chat/completions')
    expect(req.headers.authorization).toBe('Bearer secret')
    const body = JSON.parse(req.body)
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }])
  })

  it('returns failure on an HTTP error response', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret'
    const mock = await startMock()
    mock.respond((_req, res) => {
      res.statusCode = 500
      res.end('Server Error')
    })
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    const result = await reviewer.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns failure without a key and does not call the API', async () => {
    const mock = await startMock()
    mock.respond(chatOk('pong'))
    const reviewer = new DeepSeekReviewer(makeConfig({ apiBase: mock.apiBase }))

    const result = await reviewer.ping()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('missing')
    expect(mock.requests).toHaveLength(0)
  })
})

describe('reviewTimeoutBudget', () => {
  it('keeps the configured budget for ordinary reviews', () => {
    expect(reviewTimeoutBudget(3000)).toBe(3000)
  })

  it('keeps the configured budget for low-reasoning reviews', () => {
    expect(reviewTimeoutBudget(3000, 'low')).toBe(3000)
  })

  it('raises the budget to at least 30s for high-reasoning reviews', () => {
    expect(reviewTimeoutBudget(3000, 'high')).toBe(30_000)
  })

  it('never shortens an already larger configured budget', () => {
    expect(reviewTimeoutBudget(60_000, 'high')).toBe(60_000)
  })
})
