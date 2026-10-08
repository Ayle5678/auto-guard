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
  combineSignals,
  directChatPing,
  directChatReview,
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
 * When a direct endpoint (`apiBase`) is configured it takes precedence and
 * delegates to the core direct channel (ADR-0024) — the prompt contract, the
 * 400→fallback retry ladder, the timeout budget and fail-closed semantics
 * all have their single owner there. Timeout and parsing failures throw so
 * the guard service can apply fail-closed policy.
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
    return directChatPing(this.config, apiKey)
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

  /** Direct-endpoint branch: delegate to the core direct channel (ADR-0024), backup endpoint included (ADR-0026 update). */
  private async reviewDirect(request: LlmReviewRequest): Promise<LlmReviewResult> {
    const apiKey = process.env[this.config.apiKeyEnv] || this.config.apiKey || undefined
    const fallbackApiKey =
      (this.config.fallbackApiKeyEnv && process.env[this.config.fallbackApiKeyEnv]) || this.config.fallbackApiKey || undefined
    const backup = this.config.fallbackApiBase?.trim()
    // No primary key of its own: review straight on the backup endpoint when one is usable.
    const usableBackup = Boolean(backup && backup !== this.config.apiBase.trim() && fallbackApiKey)
    if (!apiKey && !usableBackup) {
      this.lastReview = { ok: false, at: Date.now(), error: `missing ${this.config.apiKeyEnv}` }
      throw new Error(`missing ${this.config.apiKeyEnv}`)
    }
    try {
      const result = await directChatReview(this.config, this.lang, request, apiKey ?? '', fallbackApiKey)
      this.lastReview = { ok: true, at: Date.now() }
      return result
    } catch (error) {
      this.lastReview = { ok: false, at: Date.now(), error: error instanceof Error ? error.message : String(error) }
      throw error
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
      signal: combineSignals(request.signal, controller.signal),
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
