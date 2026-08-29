/**
 * DSH reviewer backed by the host `ctx.llm` route (provider / model /
 * reasoningEffort / fallback), with a direct OpenAI-compatible fallback path.
 * The prompt contract, timeout budget and fail-closed semantics live in core;
 * this file only adds the host route plumbing (ADR-0002).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { createNoticeMessage } from './notice-message.ts'
import {
  httpPostText,
  parseReviewJson,
  reviewTimeoutBudget,
  reviewSystemPrompt,
  langOf,
  type GuardConfig,
  type Lang,
  type LlmReviewRequest,
  type LlmReviewResult,
  type LlmReviewer,
  type PingResult,
  type ReviewOutcome,
} from '@auto-guard/core'
import { dshMessage } from './messages.ts'

/** True when a direct OpenAI-compatible endpoint is configured. */
function hasDirectEndpoint(config: GuardConfig): boolean {
  return Boolean(config.apiBase.trim())
}

interface LlmStream {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
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

/** Provider route description for diagnostics. */
interface Route {
  tag: string
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * Reviewer backed by `ctx.llm.stream`. Tries the primary provider/model and
 * falls back to the configured fallback route on any provider/stream error.
 * When a direct endpoint (`apiBase`) is configured it takes precedence and the
 * core reviewer's direct-call behavior applies. Timeout and parsing failures
 * throw so the guard service can apply fail-closed policy.
 */
export class DshLlmReviewer implements LlmReviewer {
  private readonly ctx: Context
  private readonly config: GuardConfig
  private readonly lang: Lang
  /** Result of the last {@link review} call (success or failure), kept for in-process diagnostics. */
  lastReview: ReviewOutcome | undefined

  constructor(ctx: Context, config: GuardConfig, lang?: Lang) {
    this.ctx = ctx
    this.config = config
    // Explicit lang wins (the caller may have resolved the machine-default layer).
    this.lang = lang ?? langOf(config)
  }

  /** Lightweight connectivity check against a configured direct endpoint. */
  async ping(): Promise<PingResult> {
    if (!hasDirectEndpoint(this.config)) {
      return { ok: false, error: dshMessage(this.lang, 'pingNoDirectEndpoint') }
    }
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
      const json = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: string } }> }
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
    if (hasDirectEndpoint(this.config)) {
      return this.reviewDirect(request)
    }

    const llm = this.ctx.get('llm') as LlmStream | undefined
    if (!llm) {
      this.lastReview = { ok: false, at: Date.now(), error: 'llm service unavailable (no route)' }
      throw new Error('llm service unavailable (no route)')
    }

    const scriptText = request.script ? `\n\nScript being executed (shell text):\n${request.script}` : ''
    const deletionReasonText = request.deletionReason ? `\n\nAgent-provided deletion reason:\n${request.deletionReason}` : ''
    // Put the variable command last so the fixed prefix (system + script/reason context)
    // stays stable and maximizes prompt-cache hits.
    const { id, role, source } = createNoticeMessage('', 'auto-guard LLM review request')
    const userMessage = {
      id,
      role,
      source,
      content: [{ type: 'text', text: `${scriptText}${deletionReasonText}Command: ${request.command}` }],
    } as unknown as UserMessage

    const primary: Route = {
      tag: 'primary',
      provider: this.config.provider ?? 'deepseek-official',
      model: this.config.model,
      reasoningEffort: request.reasoningEffort ?? this.config.reasoningEffort,
    }
    try {
      const result = await this.call(llm, primary, userMessage, request)
      this.lastReview = { ok: true, at: Date.now() }
      return result
    } catch (primaryError) {
      // Fallback to the alternate official route when primary is unavailable.
      const fallback: Route = {
        tag: 'fallback',
        provider: this.config.fallbackProvider ?? 'deepseek-official',
        model: this.config.fallbackModel,
        ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      }
      try {
        const result = await this.call(llm, fallback, userMessage, request)
        this.lastReview = { ok: true, at: Date.now() }
        return result
      } catch (fallbackError) {
        this.lastReview = { ok: false, at: Date.now(), error: String(fallbackError) }
        throw new LlmUnavailableError(String(primaryError), String(fallbackError))
      }
    }
  }

  private async reviewDirect(request: LlmReviewRequest): Promise<LlmReviewResult> {
    const apiKey = process.env[this.config.apiKeyEnv] || this.config.apiKey || undefined
    if (!apiKey) {
      this.lastReview = { ok: false, at: Date.now(), error: `missing ${this.config.apiKeyEnv}` }
      throw new Error(`missing ${this.config.apiKeyEnv}`)
    }

    const scriptText = request.script ? `\n\nScript being executed (shell text):\n${request.script}` : ''
    const deletionReasonText = request.deletionReason ? `\n\nAgent-provided deletion reason:\n${request.deletionReason}` : ''
    const userMessage = `${scriptText}${deletionReasonText}Command: ${request.command}`

    try {
      const result = await this.callDirect(this.config.model, userMessage, request, apiKey)
      this.lastReview = { ok: true, at: Date.now() }
      return result
    } catch (primaryError) {
      const status = (primaryError as { status?: number })?.status
      if (status === 400 && this.config.fallbackModel !== this.config.model) {
        try {
          const result = await this.callDirect(this.config.fallbackModel, userMessage, request, apiKey)
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

  private async callDirect(model: string, userMessage: string, request: LlmReviewRequest, apiKey: string): Promise<LlmReviewResult> {
    const controller = new AbortController()
    const budget = reviewTimeoutBudget(this.config.timeoutMs, request.reasoningEffort)
    const timer = setTimeout(() => controller.abort(), budget)
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal

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

      let res: Awaited<ReturnType<typeof httpPostText>>
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

      const json = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: string } }> }
      const text = json.choices?.[0]?.message?.content ?? ''
      const parsed = parseReviewJson(text)
      if (!parsed) throw new Error('Invalid LLM review response')
      return parsed
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  private async call(
    llm: LlmStream,
    route: Route,
    userMessage: UserMessage,
    request: LlmReviewRequest,
  ): Promise<LlmReviewResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), reviewTimeoutBudget(this.config.timeoutMs, route.reasoningEffort))

    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [userMessage],
      system: reviewSystemPrompt(this.lang),
      ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort as GenerateOptions['reasoningEffort'] } : {}),
      signal: request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal,
    }

    try {
      let text = ''
      for await (const chunk of llm.stream(options)) {
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          throw new Error(`stream error (${route.tag}): ${chunk.reason.failure?.message ?? 'unknown'}`)
        }
        if (chunk.type === 'finish' && chunk.reason?.kind === 'aborted') {
          throw new Error(`stream aborted (${route.tag}): ${chunk.reason.failure?.message ?? 'unknown'}`)
        }
      }
      const parsed = parseReviewJson(text)
      if (!parsed) throw new Error(`unparseable reviewer output (${route.tag})`)
      return parsed
    } finally {
      clearTimeout(timer)
    }
  }
}

export class LlmUnavailableError extends Error {
  constructor(primary: string, fallback: string) {
    super(`LLM unavailable (primary: ${primary}; fallback: ${fallback})`)
    this.name = 'LlmUnavailableError'
  }
}
