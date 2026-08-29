/**
 * One-shot LLM reviewer backed by a direct DeepSeek-compatible Chat Completions
 * API call. Fixed system prompt, strict JSON output, timeout and fail-closed
 * handling. The API key is read from an environment variable (default
 * `DEEPSEEK_API_KEY`) so it never lands on disk.
 */
import { parseReviewJson } from './review-parse.ts'
import type { Lang } from './lang.ts'
import { langOf } from './lang.ts'
import type { GuardConfig, LlmReviewResult } from './types.ts'
import http from 'node:http'
import https from 'node:https'

export interface LlmReviewRequest {
  command: string
  workspace?: string
  script?: string | undefined
  deletionReason?: string | undefined
  reasoningEffort?: string | undefined
  signal?: AbortSignal
}

export interface LlmReviewer {
  review(request: LlmReviewRequest): Promise<LlmReviewResult>
}

/** Result of a lightweight API connectivity check. */
export interface PingResult {
  ok: boolean
  error?: string
}

/** Outcome of the most recent review call, surfaced by `/guard status`. */
export interface ReviewOutcome {
  ok: boolean
  at: number
  error?: string
}

export const REVIEW_SYSTEM_PROMPT = [
  'You are a command-safety reviewer for a full-access agent.',
  'You review ONE command and return ONLY a strict JSON object with exactly three keys:',
  '{"decision":"allow|deny|ask","risk":"low|medium|high","reason":"one sentence"}',
  '',
  'Rules:',
  '  - "allow": safe/typical development command.',
  '  - "deny": destructive, dangerous, credential-exposing, or clearly malicious command.',
  '  - "ask": uncertain or context-dependent; prefer ask over allow when unsure about destructive effects.',
  '  - risk reflects blast radius. reason is a single Chinese or English sentence.',
  '  - Never output anything besides the JSON object. No markdown fences.',
].join('\n')

/** Instruction appended for en so decision reasons land in English (ADR-0011); zh keeps the base prompt byte-identical. */
const REVIEW_REASON_LANGUAGE_EN = 'Write "reason" in English.'

/**
 * The review system prompt for one language. zh is the historical base prompt
 * (unchanged, so existing prompt-cache prefixes stay valid); en appends the
 * reason-language instruction. The instruction is a fixed suffix, so for any
 * given config the prompt stays stable across calls.
 */
export function reviewSystemPrompt(lang: Lang): string {
  return lang === 'en' ? `${REVIEW_SYSTEM_PROMPT}\n${REVIEW_REASON_LANGUAGE_EN}` : REVIEW_SYSTEM_PROMPT
}

/** Merge two abort signals, or return the single one if the other is absent. */
function combineSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (a && b) {
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b])
    return a
  }
  return a ?? b
}

/**
 * Timeout budget for one review call. High-reasoning reviews (legacy
 * directory-delete flow) legitimately take longer than the default budget, so
 * they get at least 30s; ordinary and low-reasoning reviews keep the
 * configured fast-fail budget.
 */
export function reviewTimeoutBudget(timeoutMs: number, reasoningEffort?: string): number {
  return reasoningEffort === 'high' ? Math.max(timeoutMs, 30_000) : timeoutMs
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/** Result of {@link httpPostText}: status metadata plus the raw body text. */
export interface HttpPostTextResult {
  ok: boolean
  status: number
  statusText: string
  text: string
}

export interface HttpPostTextInit {
  headers?: Record<string, string>
  body: string
  /** Socket inactivity budget; expiry and {@link HttpPostTextInit.signal} both abort as `AbortError`. */
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * One-shot POST over `node:http`/`node:https` with `agent: false`: the socket
 * closes with the response and nothing is pooled. Deliberately not global
 * `fetch` — undici's pooled keep-alive connection races `process.exit()` in
 * the host hooks on Windows and aborts inside libuv (`uv_async_send` on a
 * closing handle → exit 0xC0000409) after the decision JSON was already
 * emitted. Verified 2026-08-29: pooled fetch + exit crashed 22/22 live probes;
 * one-shot-agent + exit 0/12; the `Connection: close` header is stripped by
 * undici and does not opt out of the pool.
 */
export async function httpPostText(url: string, init: HttpPostTextInit): Promise<HttpPostTextResult> {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? https : http
  return await new Promise((resolve, reject) => {
    const req = transport.request(target, {
      method: 'POST',
      agent: false,
      headers: { ...init.headers, 'Content-Length': Buffer.byteLength(init.body) },
      timeout: init.timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage ?? '',
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    const abort = () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    req.on('timeout', abort)
    if (init.signal) {
      if (init.signal.aborted) {
        abort()
        return
      }
      init.signal.addEventListener('abort', abort, { once: true })
    }
    req.on('error', reject)
    req.end(init.body)
  })
}

/** HTTP-level error carrying the response status so callers can decide on fallback. */
class HttpError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`LLM review failed: ${status} ${statusText}`)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Reviewer that calls the DeepSeek-compatible `/chat/completions` endpoint
 * directly via {@link httpPostText} (one-shot connection, no keep-alive
 * pool). When the primary model is rejected with a 400 (e.g. unknown model
 * name) it retries once on `fallbackModel`; all other failures throw so the
 * guard service can apply its fail-closed policy.
 */
export class DeepSeekReviewer implements LlmReviewer {
  private readonly config: GuardConfig
  private readonly lang: Lang
  /** Result of the last {@link review} call (success or failure), for `/guard status`. */
  lastReview: ReviewOutcome | undefined

  constructor(config: GuardConfig, lang?: Lang) {
    this.config = config
    // Explicit lang wins (the caller may have resolved the machine-default
    // layer); otherwise fall back to the config's own language.
    this.lang = lang ?? langOf(config)
  }

  /**
   * Lightweight connectivity check: send a trivial message to the configured
   * chat/completions endpoint and report whether it replies.
   */
  async ping(): Promise<PingResult> {
    const apiKey = process.env[this.config.apiKeyEnv] || this.config.apiKey || undefined
    if (!apiKey) return { ok: false, error: `missing ${this.config.apiKeyEnv}` }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const res = await httpPostText(`${this.config.apiBase}/chat/completions`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        timeoutMs: this.config.timeoutMs,
        signal: controller.signal,
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
      }
      const json = JSON.parse(res.text) as ChatCompletionResponse
      const text = json.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.length === 0) {
        return { ok: false, error: 'Empty response' }
      }
      return { ok: true }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return { ok: false, error: 'Timed out' }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  async review(request: LlmReviewRequest): Promise<LlmReviewResult> {
    // Resolution order matches pi/DSH convention: environment variable wins over the stored key.
    const apiKey = process.env[this.config.apiKeyEnv] || this.config.apiKey || undefined
    if (!apiKey) {
      this.lastReview = { ok: false, at: Date.now(), error: `missing ${this.config.apiKeyEnv}` }
      throw new Error(`missing ${this.config.apiKeyEnv}`)
    }

    const scriptText = request.script ? `\n\nScript being executed (shell text):\n${request.script}` : ''
    const deletionReasonText = request.deletionReason ? `\n\nAgent-provided deletion reason:\n${request.deletionReason}` : ''
    // Keep the variable command at the very end so the fixed prefix (system + script/reason context)
    // stays stable and maximizes prompt-cache hits.
    const userMessage = `${scriptText}${deletionReasonText}Command: ${request.command}`

    try {
      const result = await this.call(this.config.model, userMessage, request, apiKey)
      this.lastReview = { ok: true, at: Date.now() }
      return result
    } catch (primaryError) {
      const status = (primaryError as HttpError)?.status
      if (status === 400 && this.config.fallbackModel !== this.config.model) {
        try {
          const result = await this.call(this.config.fallbackModel, userMessage, request, apiKey)
          this.lastReview = { ok: true, at: Date.now() }
          return result
        } catch (fallbackError) {
          this.lastReview = { ok: false, at: Date.now(), error: (fallbackError as Error).message }
          throw fallbackError
        }
      }
      this.lastReview = { ok: false, at: Date.now(), error: (primaryError as Error).message }
      throw primaryError
    }
  }

  private async call(model: string, userMessage: string, request: LlmReviewRequest, apiKey: string): Promise<LlmReviewResult> {
    const controller = new AbortController()
    const budget = reviewTimeoutBudget(this.config.timeoutMs, request.reasoningEffort)
    const timer = setTimeout(() => controller.abort(), budget)
    const signal = combineSignals(request.signal, controller.signal)

    try {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: reviewSystemPrompt(this.lang) },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
      }
      if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort

      let res: HttpPostTextResult
      try {
        res = await httpPostText(`${this.config.apiBase}/chat/completions`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          timeoutMs: budget,
          signal,
        })
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw new Error('LLM review timed out')
        throw e
      }

      if (!res.ok) {
        throw new HttpError(res.status, res.statusText)
      }

      const json = JSON.parse(res.text) as ChatCompletionResponse
      const text = json.choices?.[0]?.message?.content ?? ''
      const parsed = parseReviewJson(text)
      if (!parsed) throw new Error('Invalid LLM review response')
      return parsed
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}
