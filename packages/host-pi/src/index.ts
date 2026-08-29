/**
 * auto-guard extension entry for Pi.
 *
 * Loaded by Pi via `pi.extensions` (jiti executes this TypeScript directly).
 * It intercepts `tool_call` and `user_bash`, runs every guarded execution
 * through {@link GuardService.decide}, and translates the decision into a
 * Pi action:
 *  - allow  → let the tool run (optionally with the directory-delete marker stripped)
 *  - deny   → block
 *  - ask    → four-state interactive confirm (or fail-closed `headlessMode` with no UI)
 *
 * Host coupling allowed here only (ADR-0002): event wiring, decision-protocol
 * translation, ask implementation and notification channels. All guard logic
 * lives in `@auto-guard/core`.
 *
 * Output language resolves once per runtime build (four-layer resolution,
 * ADR-0011): env > config.lang > machine default > zh.
 */
import { createLocalBashOperations, isToolCallEventType, type BashOperations, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  analyzeLearnedRules,
  askMemoryLabels,
  askMemoryValueOfChoice,
  canRememberAsk,
  coreMessage,
  createAuditStore,
  resolveAskMemory,
  isDenyAskValue,
  loadAnalyzeState,
  analysisIntervalMs,
  shouldRunAutoAnalysis,
  prepareDeletionMarker,
  GuardService,
  type GuardDeps,
  HistoryStore,
  generateLearnedRules,
  loadLearnedRules,
  restoreLearnedRules,
  applyHistoryToggle,
  DeepSeekReviewer,
  resolveProcessLang,
  FileTracker,
  SessionLruCache,
  PersistentCache,
  clearApiKey,
  hasStoredApiKey,
  hydrateApiKey,
  loadApiKey,
  saveApiKey,
  loadAuditPassword,
  saveAuditPassword,
  classifyCommand,
  loadRules,
  maskKey,
  reportLines,
  setEnabled,
  applySetApi,
  TemplateCache,
  notificationText,
  notifyRoute,
  effectiveNotifyRoute,
  usesFourStateAsk,
} from '@auto-guard/core'
import type { Decision, GuardConfig, GuardRequest, Lang, RulesFile } from '@auto-guard/core'
import { AUTO_GUARD_DIR, defaultConfig, loadConfig, saveConfig } from './config.ts'
import { PI_CAPABILITIES } from './pi-capabilities.ts'
import { toGuardRequest } from './adapter.ts'
import { piMessage, type PiMessageKey } from './messages.ts'

interface GuardState {
  config: GuardConfig
  rules: RulesFile
  service: GuardService
  reviewer: DeepSeekReviewer
  audit: ReturnType<typeof createAuditStore>
  history?: HistoryStore
  learned: ReturnType<typeof loadLearnedRules>
  templateCache: TemplateCache
  /** Effective output language, resolved once per runtime build. */
  lang: Lang
}

/** True when a usable API key exists (env var, encrypted store or legacy field). */
function hasUsableApiKey(config: GuardConfig): boolean {
  return Boolean(process.env[config.apiKeyEnv] || config.apiKey)
}

/** Four-layer language resolution (env > config.lang > machine default > zh), once per runtime build. */
function resolveLang(config: GuardConfig): Lang {
  return resolveProcessLang(config.lang)
}

interface EvaluateOutcome {
  action: 'allow' | 'block'
  reason?: string
  /** Command with the directory-delete marker stripped (headless retries). */
  cleanedCommand?: string
  decision: Decision
}

function buildGuard(): GuardState {
  const config = hydrateApiKey(loadConfig(), () => loadApiKey(AUTO_GUARD_DIR))
  const lang = resolveLang(config)
  const rules = loadRules(config.rulesPath, config.defaultRulesPath)
  const sessionCache = new SessionLruCache(config.sessionCacheSize)
  const persistentCache = new PersistentCache(config.cachePath)
  const llmReviewer = new DeepSeekReviewer(config, lang)
  const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
  const auditPassword = loadAuditPassword(AUTO_GUARD_DIR)
  const audit = createAuditStore(config.auditDbPath, auditPassword)
  const history = new HistoryStore({ dbPath: config.auditDbPath, password: auditPassword, days: config.historyDays })
  const learned = loadLearnedRules(config.learnedRulesPath, [...rules.hardDeny, ...rules.alwaysReview, ...rules.directoryDelete])
  const templateCache = new TemplateCache(config.templateCachePath)
  templateCache.setCacheablePatterns(learned.cacheable)
  const deps: GuardDeps = {
    config,
    rules,
    sessionCache,
    persistentCache,
    llmReviewer,
    fileTracker,
    historyStore: history,
    templateCache,
    lang,
  }
  const service = new GuardService(deps)
  return { config, rules, service, reviewer: llmReviewer, audit, history, learned, templateCache, lang }
}

export default function (pi: ExtensionAPI): void {
  let guard = buildGuard()

  /** Re-read config + rules and rebuild the service (used by `/guard-set reload`). */
  function reloadGuard(): void {
    guard.audit.close()
    guard.history?.close()
    guard = buildGuard()
  }

  /** Reflect guard state in the footer status bar (shield + enabled/key/reviewer). */
  function updateGuardStatus(ctx: {
    ui: {
      theme: { fg: (color: 'success' | 'error' | 'warning' | 'dim', text: string) => string }
      setStatus: (key: string, text: string | undefined) => void
    }
  }): void {
    const label = '\u{1F6E1}\uFE0F auto-guard'
    const ui = ctx.ui
    if (!guard.config.enabled) {
      ui.setStatus('auto-guard', ui.theme.fg('dim', `${label}:off`))
      return
    }
    if (!hasUsableApiKey(guard.config)) {
      // Fail-closed: unknown commands would all be denied.
      ui.setStatus('auto-guard', ui.theme.fg('warning', '\u26A0 auto-guard:no-key'))
      return
    }
    const last = guard.reviewer.lastReview
    if (last && !last.ok) {
      ui.setStatus('auto-guard', ui.theme.fg('error', `${label}:${piMessage(guard.lang, 'statusReviewFailed')}`))
      return
    }
    ui.setStatus('auto-guard', ui.theme.fg('success', `${label}:on`))
  }

  /**
   * Translate a guard decision into a Pi action, performing the interactive
   * `ask` confirm and the directory-delete reason flow (interactive input or
   * headless `[删除理由]` marker).
   */
  async function evaluate(
    ctx: { hasUI: boolean; ui: { input: (t: string, p?: string) => Promise<string | undefined>; select: (t: string, o: string[]) => Promise<string | undefined>; confirm: (t: string, m: string) => Promise<boolean> } },
    request: GuardRequest,
  ): Promise<EvaluateOutcome> {
    const lang = guard.lang
    // Headless directory-delete retries carry `[删除理由] <reason>` in the
    // command; strip it before deciding so the marker never executes.
    const prepared = prepareDeletionMarker(request)
    const guardedRequest = prepared.request
    let cleanedCommand = prepared.cleanedCommand

    let decision = await guard.service.decide(guardedRequest)

    // Directory delete, first hit: block once so the AGENT supplies a
    // `[删除理由] <reason>` marker on retry. The agent authors the reason;
    // the LLM reviews it; the human only appears for ask/deny outcomes.
    if (decision.source === 'directory-delete' && decision.needsReason) {
      return { action: 'block', reason: decision.reason, decision }
    }

    // Directory delete non-allow outcomes (LLM ask/deny, or reviewer failure)
    // are all resolved by the same human confirmation; no UI fails closed.
    if (decision.source === 'directory-delete' && decision.kind !== 'allow') {
      if (ctx.hasUI) {
        const title = piMessage(lang, decision.reviewerFailed ? 'deleteFailReviewerTitle' : 'deleteFailLlmTitle')
        const override = await ctx.ui.confirm(title, `${decision.reason ?? piMessage(lang, 'deleteFailDefaultReason')}\n${piMessage(lang, 'deleteRunAnyway')}`)
        if (override) {
          return { action: 'allow', reason: decision.reason, decision }
        }
      }
      return { action: 'block', reason: decision.reason, decision }
    }

    if (decision.kind === 'allow') {
      return { action: 'allow', reason: decision.reason, cleanedCommand, decision }
    }
    if (decision.kind === 'deny') {
      return { action: 'block', reason: decision.reason, decision }
    }
    // ask → four-state interactive confirm (capability: four-state), or
    // fail-closed headless policy. Options render in the effective language;
    // the choice maps back to a semantic value, never matched by label text.
    if (ctx.hasUI) {
      if (usesFourStateAsk(PI_CAPABILITIES) && canRememberAsk(decision)) {
        const choice = await ctx.ui.select(piMessage(lang, 'askTitle'), askMemoryLabels(lang))
        if (!choice) return { action: 'block', reason: decision.reason, decision }
        const value = askMemoryValueOfChoice(choice)
        if (!value) return { action: 'block', reason: decision.reason, decision }
        let reason: string | undefined
        if (isDenyAskValue(value)) {
          reason = await ctx.ui.input(piMessage(lang, 'denyReasonTitle'), piMessage(lang, 'denyReasonPlaceholder'))
          if (reason === undefined) return { action: 'block', reason: decision.reason, decision }
        }
        const resolved = resolveAskMemory(value, reason?.trim() || decision.reason)
        if (resolved.cacheWrite) {
          const memoryCommand = decision.command ?? guardedRequest.command ?? ''
          if (memoryCommand) {
            guard.service.rememberAsk(guardedRequest, memoryCommand, resolved.cacheWrite)
          }
        }
        return resolved.action === 'allow'
          ? { action: 'allow', reason: decision.reason, decision }
          : { action: 'block', reason: resolved.reason ?? decision.reason, decision }
      }
      const ok = await ctx.ui.confirm(piMessage(lang, 'confirmTitle'), decision.reason ?? piMessage(lang, 'confirmBody'))
      return ok
        ? { action: 'allow', reason: decision.reason, decision }
        : { action: 'block', reason: decision.reason, decision }
    }
    if (guard.config.headlessMode === 'allow') {
      return { action: 'allow', reason: decision.reason, decision }
    }
    return { action: 'block', reason: decision.reason, decision }
  }

  /** Ping the configured review API and notify the user whether it is reachable. */
  async function pingAndNotify(ctx: { ui: { notify: (m: string, t?: 'info' | 'warning' | 'error') => void } }): Promise<void> {
    const ping = await guard.reviewer.ping()
    ctx.ui.notify(
      ping.ok ? piMessage(guard.lang, 'pingOk') : piMessage(guard.lang, 'pingFail', { error: ping.error ?? piMessage(guard.lang, 'unknownError') }),
      ping.ok ? 'info' : 'warning',
    )
  }

  /** Write one audit record when the experimental audit log is enabled. */
  function recordAudit(request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block', source: 'tool_call' | 'user_bash'): void {
    if (!guard.config.enabled || !guard.config.examineEnabled) return
    if (request.tool !== 'bash' && request.tool !== 'pwsh') return
    if (typeof request.command !== 'string') return
    const rulePattern = classifyCommand(request.command, guard.rules).rule?.pattern
    guard.audit.insert({
      sessionId: request.session,
      workspace: request.workspace,
      source,
      tool: request.tool,
      command: request.command,
      decision,
      finalAction,
      rulePattern,
    })
  }

  /** Notify according to the cache/LLM master flags, routed per kind + channels. */
  function maybeNotify(
    ctx: { ui: { notify: (m: string, t?: 'info' | 'warning' | 'error') => void } },
    decision: Decision,
  ): void {
    const isRuleAllow = decision.source === 'static-allow' || decision.source === 'user-confirmed'
    if (decision.source === 'session-cache' || decision.source === 'persistent-cache' || decision.source === 'history' || decision.source === 'learned') {
      if (!guard.config.notifyCacheHit) return
    } else if (decision.source === 'llm' || decision.source === 'file-tracker' || decision.source === 'directory-delete') {
      if (!guard.config.notifyLlmDecision) return
    } else if (!isRuleAllow) {
      return
    }
    let route = notifyRoute(decision, guard.config)
    // Rule-based allows are always UI-only; they never enter the model context.
    if (isRuleAllow && route === 'context') route = 'page'
    // Clamp to channels the host can actually deliver (ADR-0007).
    route = effectiveNotifyRoute(route, PI_CAPABILITIES)
    if (route === 'off') return
    if (route === 'context') {
      // customType 'auto-guard' + display=true → shown in TUI AND enters model context.
      pi.sendMessage({ customType: 'auto-guard', content: notificationText(decision, guard.lang), display: true })
      return
    }
    ctx.ui.notify(notificationText(decision, guard.lang), 'info')
  }

  pi.on('tool_call', async (event, ctx) => {
    if (!guard.config.enabled) return
    if (event.toolName !== 'bash' && event.toolName !== 'pwsh' && event.toolName !== 'write' && event.toolName !== 'edit' && event.toolName !== 'read') {
      return
    }

    const session = ctx.sessionManager.getSessionId()
    const workspace = ctx.cwd
    const signal = ctx.signal

    let request: GuardRequest | undefined
    if (isToolCallEventType('bash', event)) {
      request = toGuardRequest({ tool: 'bash', command: event.input.command, session, workspace, signal })
    } else if (event.toolName === 'pwsh') {
      const input = event.input as { command?: unknown }
      if (typeof input.command === 'string') {
        request = toGuardRequest({ tool: 'pwsh', command: input.command, session, workspace, signal })
      }
    } else if (isToolCallEventType('read', event)) {
      request = toGuardRequest({ tool: 'read', filePath: event.input.path, session, workspace, signal })
    } else if (isToolCallEventType('write', event)) {
      request = toGuardRequest({ tool: 'write', filePath: event.input.path, content: event.input.content, session, workspace, signal })
    } else if (isToolCallEventType('edit', event)) {
      request = toGuardRequest({ tool: 'edit', filePath: event.input.path, session, workspace, signal })
    } else {
      return
    }
    if (!request) return

    const outcome = await evaluate(ctx, request)
    recordAudit(request, outcome.decision, outcome.action, 'tool_call')
    maybeNotify(ctx, outcome.decision)
    if (outcome.action === 'block') {
      return { block: true, reason: outcome.reason }
    }
    if (outcome.cleanedCommand !== undefined) {
      if (isToolCallEventType('bash', event)) {
        event.input.command = outcome.cleanedCommand
      } else if (event.toolName === 'pwsh') {
        ;(event.input as { command?: unknown }).command = outcome.cleanedCommand
      }
    }
  })

  pi.on('user_bash', async (event, ctx) => {
    if (!guard.config.enabled) return
    const session = ctx.sessionManager.getSessionId()
    const request = toGuardRequest({ tool: 'bash', command: event.command, workspace: event.cwd, session, signal: ctx.signal })
    if (!request) return

    const outcome = await evaluate(ctx, request)
    recordAudit(request, outcome.decision, outcome.action, 'user_bash')
    maybeNotify(ctx, outcome.decision)
    if (outcome.action === 'block') {
      return {
        result: {
          output: outcome.reason ?? 'Blocked by auto-guard',
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      }
    }
    if (outcome.cleanedCommand !== undefined) {
      const local = createLocalBashOperations()
      const exec: BashOperations['exec'] = (command, cwd, options) => local.exec(outcome.cleanedCommand as string, cwd, options)
      return { operations: { exec } }
    }
    // allow: let Pi run the command normally
    return
  })

  pi.on('session_start', async (_event, ctx) => {
    // Stats are session-scoped: a new session starts from zero.
    guard.service.resetStats()
    updateGuardStatus(ctx)
    if (guard.config.autoAnalyzeEnabled && guard.config.examineEnabled) {
      const state = loadAnalyzeState(guard.config.analyzeStatePath)
      if (shouldRunAutoAnalysis(state, analysisIntervalMs(guard.config))) {
        void runLearnedAnalysis(ctx).catch(() => {
          // Auto analysis is best-effort; never break session startup.
        })
      }
    }
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    // Session-scoped allow/deny memory must never leak into a new session.
    guard.service.clearSessionCache(ctx.sessionManager.getSessionId())
  })

  pi.registerCommand('guard', {
    description: piMessage(guard.lang, 'guardCmdDesc'),
    handler: async (args, ctx) => {
      const t = (key: PiMessageKey, params: Record<string, string | number> = {}) => piMessage(guard.lang, key, params)
      const raw = (args ?? '').trim()
      const sub = raw.toLowerCase()
      if (sub === 'on' || sub === 'off') {
        ctx.ui.notify(setEnabled(guard.config, sub === 'on', guard.lang), 'info')
        saveConfig(guard.config)
        updateGuardStatus(ctx)
      } else if (sub === 'stats') {
        const stats = guard.service.stats
        const cacheHits = stats.sessionCacheHits + stats.persistentCacheHits
        const denominator = cacheHits + stats.llmCalls
        const rate = denominator === 0 ? 'N/A' : `${Math.round((cacheHits / denominator) * 100)}%`
        const lines = [
          t('statsLlmCalls', { count: stats.llmCalls }),
          t('statsSessionHits', { count: stats.sessionCacheHits }),
          t('statsPersistentHits', { count: stats.persistentCacheHits }),
          t('statsHistoryHits', { count: stats.historyHits }),
          t('statsLearnedHits', { count: stats.learnedHits }),
          t('statsHitRate', { rate }),
          t('statsRuleHits', {
            staticAllow: stats.ruleHits['static-allow'],
            userConfirmed: stats.ruleHits['user-confirmed'],
            hardDeny: stats.ruleHits['hard-deny'],
            directoryDelete: stats.ruleHits['directory-delete'],
            fileTracker: stats.ruleHits['file-tracker'],
            sensitivePath: stats.ruleHits['sensitive-path'],
          }),
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (sub === 'report' || sub.startsWith('report ')) {
        const daysRaw = Number(raw.slice('report'.length).trim())
        const days = daysRaw > 0 ? Math.floor(daysRaw) : 7
        if (!guard.config.examineEnabled) {
          ctx.ui.notify(t('examineStatusOff'), 'info')
          return
        }
        ctx.ui.notify(reportLines(guard.audit.summarizeSince(days), days, guard.lang).join('\n'), 'info')
      } else if (sub === 'status') {
        const last = guard.reviewer.lastReview
        const when = last ? new Date(last.at).toLocaleString() : ''
        const reviewLine = !last
          ? t('statusReviewerNever')
          : last.ok
            ? t('statusReviewerOk', { when })
            : t('statusReviewerFailed', { error: last.error ?? 'unknown', when })
        const keyLine = !hasUsableApiKey(guard.config)
          ? t('statusKeyMissing')
          : guard.config.apiKey
            ? t('statusKeyHydrated', { key: maskKey(guard.config.apiKey) })
            : t('statusKeyEnv', { name: guard.config.apiKeyEnv })
        const lines = [
          guard.config.enabled ? t('statusEnabled') : t('statusDisabled'),
          t('statusEndpoint', { base: guard.config.apiBase }),
          t('statusModel', { model: guard.config.model }),
          t('statusApiKey', { value: keyLine }),
          t('statusReviewer', { value: reviewLine }),
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else {
        ctx.ui.notify(t('guardUsage'), 'info')
      }
    },
  })

  pi.registerCommand('guard-examine', {
    description: piMessage(guard.lang, 'examineCmdDesc'),
    handler: async (args, ctx) => {
      const t = (key: PiMessageKey, params: Record<string, string | number> = {}) => piMessage(guard.lang, key, params)
      const raw = (args ?? '').trim().toLowerCase()
      if (raw === 'on') {
        if (!loadAuditPassword(AUTO_GUARD_DIR)) {
          const password = await ctx.ui.input(t('examinePasswordTitle'), t('examinePasswordPrompt'))
          if (!password || !password.trim()) {
            ctx.ui.notify(t('examineCancelled'), 'info')
            return
          }
          saveAuditPassword(AUTO_GUARD_DIR, password.trim())
        }
        guard.config.examineEnabled = true
        saveConfig(guard.config)
        reloadGuard()
        ctx.ui.notify(t('examineOn'), 'info')
      } else if (raw === 'off') {
        guard.config.examineEnabled = false
        saveConfig(guard.config)
        ctx.ui.notify(t('examineOff'), 'info')
      } else if (raw === 'status') {
        ctx.ui.notify(`${t(guard.config.examineEnabled ? 'examineStatusOn' : 'examineStatusOff')}${guard.lang === 'zh' ? '；' : '; '}${t('examineDb', { path: guard.config.auditDbPath })}`, 'info')
      } else if (raw === 'clear old') {
        const removed = guard.audit.clearOld(30)
        ctx.ui.notify(t('examineClearedOld', { count: removed }), 'info')
      } else if (raw === 'clear all') {
        guard.audit.clearAll()
        ctx.ui.notify(t('examineClearedAll'), 'info')
      } else {
        ctx.ui.notify(t('examineUsage'), 'info')
      }
    },
  })

  /** Run a learned-rule analysis through the shared core operation. */
  async function runLearnedAnalysis(ctx: { ui: { notify: (m: string, t?: 'info' | 'warning' | 'error') => void } }): Promise<void> {
    const result = analyzeLearnedRules({ config: guard.config, rules: guard.rules, audit: guard.audit }, guard.lang)
    if (!result.ok) {
      ctx.ui.notify(result.message, 'warning')
      return
    }
    guard.learned = loadLearnedRules(guard.config.learnedRulesPath, [...guard.rules.hardDeny, ...guard.rules.alwaysReview, ...guard.rules.directoryDelete])
    guard.templateCache.setCacheablePatterns(guard.learned.cacheable)
    ctx.ui.notify(piMessage(guard.lang, 'learnedAnalyzed', { count: guard.learned.cacheable.length }), 'info')
  }

  pi.registerCommand('guard-optimize', {
    description: piMessage(guard.lang, 'optimizeCmdDesc'),
    handler: async (args, ctx) => {
      const t = (key: PiMessageKey, params: Record<string, string | number> = {}) => piMessage(guard.lang, key, params)
      const raw = (args ?? '').trim().toLowerCase()
      if (raw === 'analyze') {
        await runLearnedAnalysis(ctx)
      } else if (raw === 'status') {
        const state = loadAnalyzeState(guard.config.analyzeStatePath)
        const lines = [
          t('optimizeStatusCollect', { value: t(guard.config.examineEnabled ? 'switchOn' : 'switchOff') }),
          t('optimizeStatusHistory', { value: t(guard.config.historyEnabled ? 'switchOn' : 'switchOff') }),
          t('optimizeStatusAuto', { value: t(guard.config.autoAnalyzeEnabled ? 'switchOn' : 'switchOff') }),
          t('optimizeStatusLast', { value: state.lastAnalysisAt ?? coreMessage(guard.lang, 'never') }),
          t('optimizeStatusCacheable', { count: guard.learned.cacheable.length }),
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (raw === 'list') {
        const lines = [
          'cacheable:',
          ...guard.learned.cacheable.slice(0, 20).map((r) => `  ${r.pattern}`),
        ]
        ctx.ui.notify(lines.join('\n') || t('optimizeListEmpty'), 'info')
      } else if (raw === 'rollback') {
        if (restoreLearnedRules(guard.config.learnedRulesPath, guard.config.learnedBackupPath)) {
          guard.learned = loadLearnedRules(guard.config.learnedRulesPath, [...guard.rules.hardDeny, ...guard.rules.alwaysReview, ...guard.rules.directoryDelete])
          guard.templateCache.setCacheablePatterns(guard.learned.cacheable)
          ctx.ui.notify(t('optimizeRollbackDone'), 'info')
        } else {
          ctx.ui.notify(t('optimizeRollbackNone'), 'warning')
        }
      } else if (raw === 'history on' || raw === 'history off') {
        const result = applyHistoryToggle(guard.config, raw === 'history on' ? 'on' : 'off', guard.lang)
        if (result.ok) saveConfig(guard.config)
        ctx.ui.notify(t(guard.config.historyEnabled ? 'optimizeHistoryOn' : 'optimizeHistoryOff'), 'info')
      } else if (raw === 'auto on' || raw === 'auto off') {
        guard.config.autoAnalyzeEnabled = raw === 'auto on'
        saveConfig(guard.config)
        ctx.ui.notify(t(guard.config.autoAnalyzeEnabled ? 'optimizeAutoOn' : 'optimizeAutoOff'), 'info')
      } else {
        ctx.ui.notify(t('optimizeUsage'), 'info')
      }
    },
  })

  pi.registerCommand('guard-set', {
    description: piMessage(guard.lang, 'setCmdDesc'),
    handler: async (args, ctx) => {
      const t = (key: PiMessageKey, params: Record<string, string | number> = {}) => piMessage(guard.lang, key, params)
      const raw = (args ?? '').trim()
      const sub = raw.toLowerCase()
      if (sub === 'reload') {
        reloadGuard()
        updateGuardStatus(ctx)
        ctx.ui.notify(piMessage(guard.lang, 'setReloadDone'), 'info')
      } else if (sub === 'set-key') {
        // Refuse inline arguments: anything typed in chat lands in the session transcript.
        if (raw !== 'set-key') {
          ctx.ui.notify(t('setKeyInlineWarning'), 'warning')
          return
        }
        const key = await ctx.ui.input(t('setKeyTitle'), t('setKeyPrompt'))
        if (!key || !key.trim()) {
          ctx.ui.notify(t('setKeyCancelled'), 'info')
          return
        }
        saveApiKey(AUTO_GUARD_DIR, key.trim())
        guard.config = hydrateApiKey(guard.config, () => loadApiKey(AUTO_GUARD_DIR))
        updateGuardStatus(ctx)
        ctx.ui.notify(t('setKeySaved', { key: maskKey(key.trim()) }), 'info')
        await pingAndNotify(ctx)
      } else if (sub === 'show-key') {
        const envSet = Boolean(process.env[guard.config.apiKeyEnv])
        const lines = [
          t(envSet ? 'showKeyEnvSet' : 'showKeyEnvUnset', { name: guard.config.apiKeyEnv }),
          hasStoredApiKey(AUTO_GUARD_DIR) ? t('showKeyStored', { dir: AUTO_GUARD_DIR }) : t('showKeyNoStore'),
          guard.config.apiKey ? t('showKeyLegacy', { key: maskKey(guard.config.apiKey) }) : t('showKeyNoLegacy'),
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (sub === 'clear-key') {
        // The legacy plaintext field is never rewritten (ADR-0006): only the
        // encrypted store is cleared.
        clearApiKey(AUTO_GUARD_DIR)
        updateGuardStatus(ctx)
        ctx.ui.notify(t('clearKeyDone'), 'info')
      } else if (sub.startsWith('set-api ') && sub !== 'set-api reset') {
        ctx.ui.notify(t('setApiInlineWarning'), 'warning')
      } else if (sub === 'set-api reset') {
        const defaults = defaultConfig()
        const result = applySetApi(guard.config, 'reset', undefined, defaults, guard.lang)
        const keyChoice = await ctx.ui.input(t('setApiKeyTitle'), t('setApiKeyPrompt'))
        if (keyChoice !== undefined) {
          const trimmed = keyChoice.trim()
          if (trimmed.toLowerCase() === 'clear') clearApiKey(AUTO_GUARD_DIR)
        }
        saveConfig(guard.config)
        updateGuardStatus(ctx)
        ctx.ui.notify(result.message, 'info')
        await pingAndNotify(ctx)
      } else if (sub === 'set-api') {
        const baseUrl = await ctx.ui.input(t('setApiBaseTitle'), guard.config.apiBase)
        if (baseUrl === undefined) {
          ctx.ui.notify(t('setApiCancelled'), 'info')
          return
        }
        const model = await ctx.ui.input(t('setApiModelTitle'), guard.config.model)
        if (model === undefined) {
          ctx.ui.notify(t('setApiCancelled'), 'info')
          return
        }
        if (baseUrl.trim()) guard.config.apiBase = baseUrl.trim()
        if (model.trim()) {
          guard.config.model = model.trim()
          guard.config.fallbackModel = model.trim()
        }
        saveConfig(guard.config)
        updateGuardStatus(ctx)
        ctx.ui.notify(t('setApiUpdated'), 'info')
        await pingAndNotify(ctx)
      } else {
        ctx.ui.notify(t('setUsage'), 'info')
      }
    },
  })
}
