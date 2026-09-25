import { afterEach, describe, expect, it } from 'vitest'
import { directChatPing, directChatReview, type DirectChatTuning } from '../src/llm.ts'
import { chatOk, startChatMock, type ChatMock } from './helpers/chat-mock.ts'

const openMocks: ChatMock[] = []

async function startMock(): Promise<ChatMock> {
  const mock = await startChatMock()
  openMocks.push(mock)
  return mock
}

afterEach(async () => {
  await Promise.allSettled(openMocks.splice(0).map((mock) => mock.close()))
})

/** Bare tuning slice — proves the direct channel needs no full GuardConfig. */
function tuning(overrides: Partial<DirectChatTuning> = {}): DirectChatTuning {
  return { apiBase: '', model: 'deepseek-v4-flash', fallbackModel: 'deepseek-chat', timeoutMs: 3000, ...overrides }
}

describe('directChatReview', () => {
  it('assembles the system + user prompt with the variable command last', async () => {
    const mock = await startMock()
    mock.respond(chatOk('A1'))

    await directChatReview(tuning({ apiBase: mock.apiBase }), 'zh', { command: 'rm -rf ./dist', script: 'echo hi', deletionReason: '清理' }, 'secret')

    const body = JSON.parse(mock.requests[0]!.body)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toBe('\n\nScript being executed (shell text):\necho hi\n\nAgent-provided deletion reason:\n清理Command: rm -rf ./dist')
    expect(body.temperature).toBe(0)
  })

  it('retries once on the fallback model after a 400', async () => {
    const mock = await startMock()
    let calls = 0
    mock.respond((req, res) => {
      calls += 1
      if (calls === 1) {
        res.statusCode = 400
        res.end('bad model')
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'B3: nope' } }] }))
    })

    const result = await directChatReview(tuning({ apiBase: mock.apiBase }), 'zh', { command: 'ls' }, 'secret')

    expect(result).toEqual({ decision: 'deny', risk: 'high', reason: 'nope' })
    expect(calls).toBe(2)
    expect(JSON.parse(mock.requests[1]!.body).model).toBe('deepseek-chat')
  })

  it('does not retry the fallback when it is the primary model', async () => {
    const mock = await startMock()
    let calls = 0
    mock.respond((_req, res) => {
      calls += 1
      res.statusCode = 400
      res.end('bad model')
    })

    await expect(directChatReview(tuning({ apiBase: mock.apiBase, fallbackModel: 'deepseek-v4-flash' }), 'zh', { command: 'ls' }, 'secret')).rejects.toThrow('LLM review failed: 400')

    expect(calls).toBe(1)
  })
})

describe('directChatPing', () => {
  it('reports ok when the endpoint replies with content', async () => {
    const mock = await startMock()
    mock.respond(chatOk('pong'))

    const result = await directChatPing(tuning({ apiBase: mock.apiBase }), 'secret')

    expect(result).toEqual({ ok: true })
    expect(mock.requests[0]!.path).toBe('/chat/completions')
  })

  it('reports the HTTP status on an error response', async () => {
    const mock = await startMock()
    mock.respond((_req, res) => {
      res.statusCode = 500
      res.end('boom')
    })

    const result = await directChatPing(tuning({ apiBase: mock.apiBase }), 'secret')

    expect(result).toEqual({ ok: false, error: 'HTTP 500 Internal Server Error' })
  })
})
