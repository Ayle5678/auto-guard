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

describe('directChatReview backup endpoint (SPEC 0025)', () => {
  it('retries once on the backup endpoint when the primary leg times out', async () => {
    const primary = await startMock()
    const backup = await startMock()
    // Never respond: the primary leg burns its socket-inactivity budget and aborts.
    primary.respond(() => {})
    backup.respond(chatOk('A1'))

    const result = await directChatReview(
      tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase, fallbackModel: 'mimo-v2.6-flash', timeoutMs: 100 }),
      'zh',
      { command: 'ls' },
      'primary-secret',
      'backup-secret',
    )

    expect(result.decision).toBe('allow')
    expect(result.risk).toBe('low')
    expect(primary.requests).toHaveLength(1)
    expect(backup.requests).toHaveLength(1)
    expect(JSON.parse(backup.requests[0]!.body).model).toBe('mimo-v2.6-flash')
    expect(backup.requests[0]!.headers.authorization).toBe('Bearer backup-secret')
  })

  it('retries on the backup endpoint after a primary 5xx', async () => {
    const primary = await startMock()
    const backup = await startMock()
    primary.respond((_req, res) => {
      res.statusCode = 503
      res.end('unavailable')
    })
    backup.respond(chatOk('B2: risky'))

    const result = await directChatReview(tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase }), 'zh', { command: 'ls' }, 'a', 'b')

    expect(result).toEqual({ decision: 'deny', risk: 'medium', reason: 'risky' })
    expect(primary.requests).toHaveLength(1)
    expect(backup.requests).toHaveLength(1)
  })

  it('routes a primary 400 to the backup endpoint instead of the same-endpoint model retry', async () => {
    const primary = await startMock()
    const backup = await startMock()
    primary.respond((_req, res) => {
      res.statusCode = 400
      res.end('bad model')
    })
    backup.respond(chatOk('A1'))

    await directChatReview(tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase }), 'zh', { command: 'ls' }, 'a', 'b')

    expect(primary.requests).toHaveLength(1)
    expect(backup.requests).toHaveLength(1)
  })

  it('aggregates both legs into one error when both fail', async () => {
    const primary = await startMock()
    const backup = await startMock()
    primary.respond((_req, res) => {
      res.statusCode = 500
      res.end('boom')
    })
    backup.respond((_req, res) => {
      res.statusCode = 502
      res.end('bad gateway')
    })

    let message = ''
    await directChatReview(tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase }), 'zh', { command: 'ls' }, 'a', 'b').catch(
      (error: Error) => {
        message = error.message
      },
    )

    expect(message).toContain('LLM review failed (primary: LLM review failed: 500')
    expect(message).toContain('fallback: LLM review failed: 502')
  })

  it('does not blind-retry the backup endpoint without a fallback key', async () => {
    const primary = await startMock()
    const backup = await startMock()
    primary.respond((_req, res) => {
      res.statusCode = 500
      res.end('boom')
    })
    backup.respond(chatOk('A1'))

    await expect(directChatReview(tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase }), 'zh', { command: 'ls' }, 'a')).rejects.toThrow(
      'LLM review failed: 500',
    )

    expect(backup.requests).toHaveLength(0)
  })

  it('ignores a backup endpoint equal to the primary', async () => {
    const mock = await startMock()
    let calls = 0
    mock.respond((_req, res) => {
      calls += 1
      res.statusCode = 400
      res.end('bad model')
    })

    // Equal base keeps the legacy same-endpoint 400 ladder: fallbackModel === model here, so no retry at all.
    await expect(
      directChatReview(tuning({ apiBase: mock.apiBase, fallbackApiBase: mock.apiBase, fallbackModel: 'deepseek-v4-flash' }), 'zh', { command: 'ls' }, 'a', 'b'),
    ).rejects.toThrow('LLM review failed: 400')
    expect(calls).toBe(1)
  })

  it('reviews straight on the backup endpoint when the primary key is absent (SPEC 0026)', async () => {
    const primary = await startMock()
    const backup = await startMock()
    backup.respond(chatOk('A1'))

    const result = await directChatReview(tuning({ apiBase: primary.apiBase, fallbackApiBase: backup.apiBase }), 'zh', { command: 'ls' }, '', 'backup-secret')

    expect(result.decision).toBe('allow')
    expect(primary.requests).toHaveLength(0)
    expect(backup.requests).toHaveLength(1)
    expect(JSON.parse(backup.requests[0]!.body).model).toBe('deepseek-chat')
  })

  it('throws the missing-key error when no primary key and no usable backup exist', async () => {
    const mock = await startMock()
    mock.respond(chatOk('A1'))

    await expect(directChatReview(tuning({ apiBase: mock.apiBase }), 'zh', { command: 'ls' }, '')).rejects.toThrow(
      'LLM review missing primary API key',
    )
    expect(mock.requests).toHaveLength(0)
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
