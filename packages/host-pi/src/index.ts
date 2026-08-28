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
 */
import { createLocalBashOperations, isToolCallEventType, type BashOperations, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  analyzeLearnedRules,
  ASK_MEMORY_OPTIONS,
  canRememberAsk,
  createAuditStore,
  resolveAskMemory,
  loadAnalyzeState,
  analysisIntervalMs,
  shouldRunAutoAnalysis,
  updateLastAnalysis,
  prepareDeletionMarker,
  GuardService,
  type GuardDeps,
  HistoryStore,
  generateLearnedRules,
  loadLearnedRules,
  restoreLearnedRules,
  applyHistoryToggle,
  DeepSeekReviewer,
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
  setEnabled,
  applySetApi,
  TemplateCache,
  notificationText,
  notifyRoute,
  effectiveNotifyRoute,
  usesFourStateAsk,
} from '@auto-guard/core'
import type { Decision, GuardConfig, GuardRequest, RulesFile } from '@auto-guard/core'
import { AUTO_GUARD_DIR, defaultConfig, loadConfig, saveConfig } from './config.ts'
import { PI_CAPABILITIES } from './pi-capabilities.ts'
import { toGuardRequest } from './adapter.ts'

interface GuardState {
  config: GuardConfig
  rules: RulesFile
  service: GuardService
  reviewer: DeepSeekReviewer
  audit: ReturnType<typeof createAuditStore>
  history?: HistoryStore
  learned: ReturnType<typeof loadLearnedRules>
  templateCache: TemplateCache
}

/** True when a usable API key exists (env var, encrypted store or legacy field). */
function hasUsableApiKey(config: GuardConfig): boolean {
  return Boolean(process.env[config.apiKeyEnv] || config.apiKey)
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
  const rules = loadRules(config.rulesPath, config.defaultRulesPath)
  const sessionCache = new SessionLruCache(config.sessionCacheSize)
  const persistentCache = new PersistentCache(config.cachePath)
  const llmReviewer = new DeepSeekReviewer(config)
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
  }
  const service = new GuardService(deps)
  return { config, rules, service, reviewer: llmReviewer, audit, history, learned, templateCache }
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
      ui.setStatus('auto-guard', ui.theme.fg('error', `${label}:审查✗`))
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
        const title = decision.reviewerFailed ? '审查器故障，这次删除未过审' : 'LLM 未通过这次删除'
        const override = await ctx.ui.confirm(title, `${decision.reason ?? '审查未通过'}\n仍要执行吗？`)
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
    // fail-closed headless policy.
    if (ctx.hasUI) {
      if (usesFourStateAsk(PI_CAPABILITIES) && canRememberAsk(decision)) {
        const choice = await ctx.ui.select('LLM 不确定，如何决定？', [...ASK_MEMORY_OPTIONS])
        if (!choice) return { action: 'block', reason: decision.reason, decision }
        let reason: string | undefined
        if (choice === '拒绝（可输原因）' || choice === '本会话都拒绝（可输原因）') {
          reason = await ctx.ui.input('拒绝原因', '可选，留空使用系统原因')
          if (reason === undefined) return { action: 'block', reason: decision.reason, decision }
        }
        const resolved = resolveAskMemory(choice, reason?.trim() || decision.reason)
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
      const ok = await ctx.ui.confirm('需要确认', decision.reason ?? '是否允许执行？')
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
    ctx.ui.notify(ping.ok ? 'API 联通成功' : `API 联通失败：${ping.error ?? '未知错误'}`, ping.ok ? 'info' : 'warning')
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
      pi.sendMessage({ customType: 'auto-guard', content: notificationText(decision), display: true })
      return
    }
    ctx.ui.notify(notificationText(decision), 'info')
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
    description: '守卫运行时：/guard on | off | status | stats',
    handler: async (args, ctx) => {
      const raw = (args ?? '').trim()
      const sub = raw.toLowerCase()
      if (sub === 'on' || sub === 'off') {
        ctx.ui.notify(setEnabled(guard.config, sub === 'on'), 'info')
        saveConfig(guard.config)
        updateGuardStatus(ctx)
      } else if (sub === 'stats') {
        const stats = guard.service.stats
        const cacheHits = stats.sessionCacheHits + stats.persistentCacheHits
        const denominator = cacheHits + stats.llmCalls
        const rate = denominator === 0 ? 'N/A' : `${Math.round((cacheHits / denominator) * 100)}%`
        const lines = [
          `LLM 调用：${stats.llmCalls}`,
          `会话缓存命中：${stats.sessionCacheHits}`,
          `持久缓存命中：${stats.persistentCacheHits}`,
          `历史命中：${stats.historyHits}`,
          `学习规则命中：${stats.learnedHits}`,
          `命中率：${rate}`,
          `规则命中：static-allow ${stats.ruleHits['static-allow']} / user-confirmed ${stats.ruleHits['user-confirmed']} / hard-deny ${stats.ruleHits['hard-deny']} / directory-delete ${stats.ruleHits['directory-delete']} / file-tracker ${stats.ruleHits['file-tracker']} / sensitive-path ${stats.ruleHits['sensitive-path']}`,
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (sub === 'status') {
        const last = guard.reviewer.lastReview
        const when = last ? new Date(last.at).toLocaleString() : ''
        const reviewLine = !last
          ? '从未调用（尚未拦截过需要审查的命令）'
          : last.ok
            ? `正常（最近一次 ${when}）`
            : `失败：${last.error ?? 'unknown'}（${when}）`
        const keyLine = !hasUsableApiKey(guard.config)
          ? '未配置（未知命令将全部被拒绝）'
          : guard.config.apiKey
            ? `已水合 ${maskKey(guard.config.apiKey)}`
            : `环境变量 ${guard.config.apiKeyEnv} 已配置`
        const lines = [
          `守卫状态：${guard.config.enabled ? '已启用' : '已停用'}`,
          `审查端点：${guard.config.apiBase}`,
          `模型：${guard.config.model}`,
          `API Key：${keyLine}`,
          `审查器：${reviewLine}`,
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else {
        ctx.ui.notify('用法：/guard on | off | status | stats', 'info')
      }
    },
  })

  pi.registerCommand('guard-examine', {
    description: '实验性审查日志：/guard-examine on | off | status | clear old | clear all',
    handler: async (args, ctx) => {
      const raw = (args ?? '').trim().toLowerCase()
      if (raw === 'on') {
        if (!loadAuditPassword(AUTO_GUARD_DIR)) {
          const password = await ctx.ui.input('审计库密码', '开启历史记录需要设置密码（用于加密审计库）')
          if (!password || !password.trim()) {
            ctx.ui.notify('已取消，未开启审查日志', 'info')
            return
          }
          saveAuditPassword(AUTO_GUARD_DIR, password.trim())
        }
        guard.config.examineEnabled = true
        saveConfig(guard.config)
        reloadGuard()
        ctx.ui.notify('审查日志已开启（实验性，审计库已加密）', 'info')
      } else if (raw === 'off') {
        guard.config.examineEnabled = false
        saveConfig(guard.config)
        ctx.ui.notify('审查日志已关闭', 'info')
      } else if (raw === 'status') {
        ctx.ui.notify(`审查日志：${guard.config.examineEnabled ? '已开启' : '已关闭'}；数据库：${guard.config.auditDbPath}`, 'info')
      } else if (raw === 'clear old') {
        const removed = guard.audit.clearOld(30)
        ctx.ui.notify(`已删除 ${removed} 条 30 天前的审查日志`, 'info')
      } else if (raw === 'clear all') {
        guard.audit.clearAll()
        ctx.ui.notify('已清空全部审查日志', 'info')
      } else {
        ctx.ui.notify('用法：/guard-examine on | off | status | clear old | clear all', 'info')
      }
    },
  })

  /** Run a learned-rule analysis through the shared core operation. */
  async function runLearnedAnalysis(ctx: { ui: { notify: (m: string, t?: 'info' | 'warning' | 'error') => void } }): Promise<void> {
    const result = analyzeLearnedRules({ config: guard.config, rules: guard.rules, audit: guard.audit })
    if (!result.ok) {
      ctx.ui.notify(result.message, 'warning')
      return
    }
    guard.learned = loadLearnedRules(guard.config.learnedRulesPath, [...guard.rules.hardDeny, ...guard.rules.alwaysReview, ...guard.rules.directoryDelete])
    guard.templateCache.setCacheablePatterns(guard.learned.cacheable)
    ctx.ui.notify(`学习规则分析完成：cacheable ${guard.learned.cacheable.length}`, 'info')
  }

  pi.registerCommand('guard-optimize', {
    description: '学习规则维护：/guard-optimize status | analyze | list | rollback | history on|off | auto on|off',
    handler: async (args, ctx) => {
      const raw = (args ?? '').trim().toLowerCase()
      if (raw === 'analyze') {
        await runLearnedAnalysis(ctx)
      } else if (raw === 'status') {
        const state = loadAnalyzeState(guard.config.analyzeStatePath)
        const lines = [
          `收集开关：${guard.config.examineEnabled ? '开' : '关'}`,
          `历史层：${guard.config.historyEnabled ? '开' : '关'}`,
          `自动分析：${guard.config.autoAnalyzeEnabled ? '开' : '关'}`,
          `上次分析：${state.lastAnalysisAt ?? '从未'}`,
          `cacheable：${guard.learned.cacheable.length}`,
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (raw === 'list') {
        const lines = [
          'cacheable:',
          ...guard.learned.cacheable.slice(0, 20).map((r) => `  ${r.pattern}`),
        ]
        ctx.ui.notify(lines.join('\n') || '（无学习规则）', 'info')
      } else if (raw === 'rollback') {
        if (restoreLearnedRules(guard.config.learnedRulesPath, guard.config.learnedBackupPath)) {
          guard.learned = loadLearnedRules(guard.config.learnedRulesPath, [...guard.rules.hardDeny, ...guard.rules.alwaysReview, ...guard.rules.directoryDelete])
          guard.templateCache.setCacheablePatterns(guard.learned.cacheable)
          ctx.ui.notify('已从 backup 恢复学习规则', 'info')
        } else {
          ctx.ui.notify('没有可恢复的 backup', 'warning')
        }
      } else if (raw === 'history on' || raw === 'history off') {
        const result = applyHistoryToggle(guard.config, raw === 'history on' ? 'on' : 'off')
        if (result.ok) saveConfig(guard.config)
        ctx.ui.notify(`运行时历史层已${guard.config.historyEnabled ? '开启' : '关闭'}`, 'info')
      } else if (raw === 'auto on' || raw === 'auto off') {
        guard.config.autoAnalyzeEnabled = raw === 'auto on'
        saveConfig(guard.config)
        ctx.ui.notify(`自动分析已${guard.config.autoAnalyzeEnabled ? '开启' : '关闭'}`, 'info')
      } else {
        ctx.ui.notify('用法：/guard-optimize status | analyze | list | rollback | history on|off | auto on|off', 'info')
      }
    },
  })

  pi.registerCommand('guard-set', {
    description: '守卫配置与维护：/guard-set reload | set-key | show-key | clear-key | set-api | set-api reset',
    handler: async (args, ctx) => {
      const raw = (args ?? '').trim()
      const sub = raw.toLowerCase()
      if (sub === 'reload') {
        reloadGuard()
        updateGuardStatus(ctx)
        ctx.ui.notify('auto-guard 已重载配置与规则', 'info')
      } else if (sub === 'set-key') {
        // Refuse inline arguments: anything typed in chat lands in the session transcript.
        if (raw !== 'set-key') {
          ctx.ui.notify('为避免密钥进入会话记录，请不带参数运行 /guard-set set-key，在弹窗中输入', 'warning')
          return
        }
        const key = await ctx.ui.input('Auto Guard API Key', '输入 API Key（sk-...），AES-GCM 加密存储于 ~/.pi/auto-guard/api-key.json')
        if (!key || !key.trim()) {
          ctx.ui.notify('已取消，未修改 API Key', 'info')
          return
        }
        saveApiKey(AUTO_GUARD_DIR, key.trim())
        guard.config = hydrateApiKey(guard.config, () => loadApiKey(AUTO_GUARD_DIR))
        updateGuardStatus(ctx)
        ctx.ui.notify(`API Key 已保存（加密落盘，${maskKey(key.trim())}）`, 'info')
        await pingAndNotify(ctx)
      } else if (sub === 'show-key') {
        const envSet = Boolean(process.env[guard.config.apiKeyEnv])
        const lines = [
          `环境变量 ${guard.config.apiKeyEnv}：${envSet ? '已配置（优先生效）' : '未配置'}`,
          `加密存储：${hasStoredApiKey(AUTO_GUARD_DIR) ? `已存储（AES-GCM 加密于 ${AUTO_GUARD_DIR}/api-key.json）` : '(未存储)'}`,
          `明文遗留：${guard.config.apiKey ? `${maskKey(guard.config.apiKey)}（只读保留，建议 set-key 重存加密版）` : '(无)'}`,
        ]
        ctx.ui.notify(lines.join('\n'), 'info')
      } else if (sub === 'clear-key') {
        // The legacy plaintext field is never rewritten (ADR-0006): only the
        // encrypted store is cleared.
        clearApiKey(AUTO_GUARD_DIR)
        updateGuardStatus(ctx)
        ctx.ui.notify('已清除加密存储的 API Key（明文遗留字段保持只读；环境变量不受影响）', 'info')
      } else if (sub.startsWith('set-api ') && sub !== 'set-api reset') {
        ctx.ui.notify('为避免密钥进入会话记录，set-api 不接受参数；请运行 /guard-set set-api 或 /guard-set set-api reset', 'warning')
      } else if (sub === 'set-api reset') {
        const defaults = defaultConfig()
        const result = applySetApi(guard.config, 'reset', undefined, defaults)
        const keyChoice = await ctx.ui.input('API Key', '留空=保留现有 Key；输入 clear 清除加密存储的 Key')
        if (keyChoice !== undefined) {
          const trimmed = keyChoice.trim()
          if (trimmed.toLowerCase() === 'clear') clearApiKey(AUTO_GUARD_DIR)
        }
        saveConfig(guard.config)
        updateGuardStatus(ctx)
        ctx.ui.notify(result.message, 'info')
        await pingAndNotify(ctx)
      } else if (sub === 'set-api') {
        const baseUrl = await ctx.ui.input('审查端点 Base URL', guard.config.apiBase)
        if (baseUrl === undefined) {
          ctx.ui.notify('已取消，未修改审查端点', 'info')
          return
        }
        const model = await ctx.ui.input('审查模型', guard.config.model)
        if (model === undefined) {
          ctx.ui.notify('已取消，未修改审查端点', 'info')
          return
        }
        if (baseUrl.trim()) guard.config.apiBase = baseUrl.trim()
        if (model.trim()) {
          guard.config.model = model.trim()
          guard.config.fallbackModel = model.trim()
        }
        saveConfig(guard.config)
        updateGuardStatus(ctx)
        ctx.ui.notify('审查端点已更新', 'info')
        await pingAndNotify(ctx)
      } else {
        ctx.ui.notify('用法：/guard-set reload | set-key | show-key | clear-key | set-api | set-api reset', 'info')
      }
    },
  })
}
