/**
 * auto-guard plugin entry for DSH (DeepSeek Harness).
 *
 * Mounts:
 *  - a `tools/pre-execute` listener that routes bash/pwsh through the guard
 *    service and write/edit/read through the sensitive-path gate;
 *  - a monotonic `ctx.tools.guard()` for the absolute blacklist (final deny);
 *  - optional user-visible decision notifications (page events / context inject);
 *  - an encrypted SQLCipher audit log (ADR-0005);
 *  - DSH settings namespace wiring with one-time legacy config migration.
 *
 * Enable/disable is the conversation permission preset (dsh ADR-0014):
 * selecting the `auto-guard` preset in the chat bar turns the guard on, any
 * other preset turns it off. There are no slash commands on this host.
 *
 * Host coupling allowed here only (ADR-0002): event wiring, decision-protocol
 * translation, notification channels and settings mounting.
 */
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  classifyCommand,
  effectiveLang,
  envLang,
  expandHome,
  generateLearnedRules,
  GuardService,
  HistoryStore,
  loadAnalyzeState,
  loadLearnedRules,
  machineConfigPath,
  prepareDeletionMarker,
  readMachineLang,
  restoreLearnedRules,
  SessionLruCache,
  PersistentCache,
  SqlcipherAuditStore,
  LightAuditStore,
  createAuditStore,
  effectiveNotifyRoute,
  type AuditStore,
  shouldRunAutoAnalysis,
  analysisIntervalMs,
  TemplateCache,
  loadRules,
  updateLastAnalysis,
  writeLearnedRules,
  type Decision,
  type GuardConfig,
  type GuardRequest,
  type Lang,
  type RulesFile,
} from '@auto-guard/core'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import { toGuardRequest, type ExecutionLike } from './adapter.ts'
import { DSH_CAPABILITIES } from './dsh-capabilities.ts'
import { createContextNotice, createPageNoticeEvents, notifyRoute } from './notify-policy.ts'
import { dshMessage } from './messages.ts'
import { DshLlmReviewer } from './dsh-reviewer.ts'
import { FileTracker } from '@auto-guard/core'
import { AUTO_GUARD_DIR, installGuardSettings, loadConfig } from './config.ts'

export const name = 'auto-guard'
export const inject = ['tools', 'permissionPresets']

/** Audit surface dsh relies on: the shared interface plus SQLCipher extras that degrade gracefully. */
type DshAudit = AuditStore & Partial<Pick<SqlcipherAuditStore, 'rekey' | 'setPassword' | 'createNew' | 'exportPlaintext'>>

interface GuardState {
  config: GuardConfig
  rules: RulesFile
  service: GuardService
  audit: DshAudit
  history?: HistoryStore
  learned: ReturnType<typeof loadLearnedRules>
  templateCache: TemplateCache
  /** Effective output language, resolved once per state build. */
  lang: Lang
}

function createState(
  ctx: Context,
  patchConfig: Partial<GuardConfig>,
  config: GuardConfig,
  settings: ReturnType<typeof installGuardSettings>,
): GuardState {
  settings.syncFromSettings()
  const lang = effectiveLang({
    env: envLang(),
    configLang: config.lang,
    machineLang: readMachineLang(machineConfigPath(homedir())),
  })
  const rules = loadRules(expandHome(config.rulesPath), expandHome(config.defaultRulesPath))
  const sessionCache = new SessionLruCache(config.sessionCacheSize)
  const persistentCache = new PersistentCache(expandHome(config.cachePath))
  const llmReviewer = new DshLlmReviewer(ctx, config, lang)
  const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000)
  // ADR-0005: SQLCipher is the dsh implementation but the optional native
  // dependency may be absent; degrade to Light rather than losing the audit.
  let audit: DshAudit
  if (config.auditPassword) {
    try {
      audit = new SqlcipherAuditStore(expandHome(config.auditDbPath), config.auditPassword)
    } catch {
      audit = new LightAuditStore(expandHome(config.auditDbPath), config.auditPassword)
    }
  } else {
    audit = createAuditStore(expandHome(config.auditDbPath))
  }
  const history = new HistoryStore({ dbPath: config.auditDbPath, password: config.auditPassword, days: config.historyDays, store: audit })
  const learned = loadLearnedRules(config.learnedRulesPath, [...rules.hardDeny, ...rules.alwaysReview, ...rules.directoryDelete])
  const templateCache = new TemplateCache(config.templateCachePath)
  templateCache.setCacheablePatterns(learned.cacheable)
  const service = new GuardService({
    config,
    rules,
    sessionCache,
    persistentCache,
    llmReviewer,
    fileTracker,
    historyStore: history,
    templateCache,
    lang,
  })
  return { config, rules, service, audit, history, learned, templateCache, lang }
}

/** Run a learned-rule analysis and overwrite learned-rules.json. */
function runLearnedAnalysis(state: GuardState): { ok: boolean; message: string } {
  const lang = state.lang
  if (!state.config.examineEnabled) {
    return { ok: false, message: dshMessage(lang, 'analyzeNeedsExamine') }
  }
  if (!state.config.auditPassword) {
    return { ok: false, message: dshMessage(lang, 'analyzeNeedsPassword') }
  }
  const rules = generateLearnedRules(state.audit.list(), {
    days: state.config.historyDays,
    cacheableMinTotal: state.config.learnedCacheableMinTotal,
    cacheableMinLlm: 1,
    sensitivePaths: state.rules.sensitivePaths,
    excludedRules: [...state.rules.hardDeny, ...state.rules.alwaysReview, ...state.rules.directoryDelete],
  })
  writeLearnedRules(state.config.learnedRulesPath, state.config.learnedBackupPath, rules)
  state.learned = rules
  state.templateCache.setCacheablePatterns(rules.cacheable)
  updateLastAnalysis(state.config.analyzeStatePath)
  return { ok: true, message: dshMessage(lang, 'analyzeDone', { count: rules.cacheable.length }) }
}

/** Remote service exposed to the settings page via Typert Remote. */
function createAutoGuardRemote(state: GuardState): Record<string, unknown> {
  const t = (key: Parameters<typeof dshMessage>[1], params: Record<string, string | number> = {}) => dshMessage(state.lang, key, params)
  const service = {
    analyzeNow(): { ok: boolean; message: string } {
      return runLearnedAnalysis(state)
    },
    listRules(): ReturnType<typeof loadLearnedRules> {
      return state.learned
    },
    rollback(): { ok: boolean; message: string } {
      if (!restoreLearnedRules(state.config.learnedRulesPath, state.config.learnedBackupPath)) {
        return { ok: false, message: t('rollbackNone') }
      }
      state.learned = loadLearnedRules(state.config.learnedRulesPath, [...state.rules.hardDeny, ...state.rules.alwaysReview, ...state.rules.directoryDelete])
      state.templateCache.setCacheablePatterns(state.learned.cacheable)
      return { ok: true, message: t('rollbackDone') }
    },
    status(): Record<string, unknown> {
      const stateFile = loadAnalyzeState(state.config.analyzeStatePath)
      return {
        examineEnabled: state.config.examineEnabled,
        historyEnabled: state.config.historyEnabled,
        autoAnalyzeEnabled: state.config.autoAnalyzeEnabled,
        lastAnalysisAt: stateFile.lastAnalysisAt ?? null,
        cacheableCount: state.learned.cacheable.length,
      }
    },
    clearOld(): { removed: number } {
      return { removed: state.audit.clearOld(30) }
    },
    clearAll(): { ok: boolean } {
      state.audit.clearAll()
      return { ok: true }
    },
    exportPlaintext(): { ok: boolean; message: string } {
      if (!state.audit.exportPlaintext) return { ok: false, message: t('exportUnsupported') }
      const ok = state.audit.exportPlaintext(join(AUTO_GUARD_DIR, 'audit.export.db'))
      return ok
        ? { ok: true, message: t('exportDone') }
        : { ok: false, message: t('exportFailed') }
    },
    createNewAudit(): { ok: boolean; message: string } {
      if (!state.config.auditPassword) return { ok: false, message: t('createNeedsPassword') }
      if (!state.audit.createNew) return { ok: false, message: t('createUnsupported') }
      const ok = state.audit.createNew(state.config.auditPassword)
      return ok
        ? { ok: true, message: t('createDone') }
        : { ok: false, message: t('createFailed') }
    },
    stats(): Record<string, unknown> {
      return { ...state.service.stats }
    },
  }
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'autoGuard', namespace: 'autoGuard' },
  })
  return service
}

export function apply(ctx: Context, patchConfig: Partial<GuardConfig> = {}): void {
  const config = loadConfig(undefined, patchConfig)
  let state!: GuardState
  const settings = installGuardSettings(ctx, config, patchConfig, undefined, (newPassword) => {
    state?.audit.setPassword?.(newPassword)
  })
  state = createState(ctx, patchConfig, config, settings)
  ctx.provide('autoGuard', createAutoGuardRemote(state))

  /** Write one audit record when the experimental audit log is enabled. */
  function recordAudit(request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block' | undefined): void {
    if (!state.config.examineEnabled) return
    if (!state.config.auditPassword) return
    if (request.tool !== 'bash' && request.tool !== 'pwsh') return
    if (typeof request.command !== 'string') return
    const rulePattern = classifyCommand(request.command, state.rules).rule?.pattern
    state.audit.insert({
      sessionId: request.session,
      workspace: request.workspace,
      source: 'tool_call',
      tool: request.tool,
      command: request.command,
      decision,
      finalAction,
      rulePattern,
    })
  }

  const permissionPresets = ctx.get('permissionPresets') as
    | {
        current(events: readonly unknown[]): string
      }
    | undefined

  /** Only sessions on the Auto Guard preset are intercepted. */
  function activeFor(exec: ToolExecution): boolean {
    if (!permissionPresets || !exec.agent?.session) return true
    try {
      return permissionPresets.current(exec.agent.session.events as unknown[]) === 'auto-guard'
    } catch {
      // Unknown service shape: keep enforcing to stay fail-safe.
      return true
    }
  }

  function notify(exec: ToolExecution, decision: Decision): void {
    if (!exec.agent) return
    const isRuleAllow = decision.source === 'static-allow' || decision.source === 'user-confirmed'
    if (decision.source === 'session-cache' || decision.source === 'persistent-cache' || decision.source === 'history' || decision.source === 'learned') {
      if (!state.config.notifyCacheHit) return
    } else if (decision.source === 'llm' || decision.source === 'file-tracker' || decision.source === 'directory-delete') {
      if (!state.config.notifyLlmDecision) return
    } else if (!isRuleAllow) {
      return
    }
    let route = notifyRoute(decision, state.config)
    // Rule-based allows are always UI-only; they never enter the model context.
    if (isRuleAllow && route === 'context') route = 'page'
    // Clamp to channels the host can actually deliver (ADR-0007).
    route = effectiveNotifyRoute(route, DSH_CAPABILITIES)
    if (route === 'off') return

    if (route === 'context') {
      const message = createContextNotice(decision, state.lang)
      try {
        exec.agent.session?.inject?.(message)
      } catch {
        // Notification is best-effort; never fail the tool call because of it.
      }
      return
    }

    const commandId = `auto-guard-${randomUUID()}`
    const events = createPageNoticeEvents(decision, commandId, state.lang)
    const session = exec.agent.session as { append(type: string, data: unknown): unknown } | undefined
    try {
      session?.append('command/run', events.run)
      session?.append('command/done', events.done)
    } catch {
      // Notification is best-effort; never fail the tool call because of it.
    }
  }

  async function _preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision | undefined>): Promise<PreToolDecision> {
    if (!activeFor(exec)) return undefined as unknown as PreToolDecision
    const request = toGuardRequest(exec as ExecutionLike)
    if (!request) return undefined as unknown as PreToolDecision

    // Headless directory-delete retries carry `[删除理由] <reason>` in the
    // command; strip it before deciding so the marker never executes.
    const prepared = prepareDeletionMarker(request)
    const decision = await state.service.decide(prepared.request)
    notify(exec, decision)

    // Directory delete, first hit: block once so the AGENT supplies a
    // `[删除理由] <reason>` marker on retry. The agent authors the reason;
    // the LLM reviews it; the human only appears for ask/deny outcomes.
    if (decision.source === 'directory-delete' && decision.needsReason) {
      recordAudit(request, decision, 'block')
      return { kind: 'deny', reason: decision.reason ?? 'Directory deletion requires a reason' }
    }

    if (decision.kind === 'deny' && decision.source === 'directory-delete') {
      // DSH has no plugin-owned confirm dialog; route this through `ask` so
      // the human can still veto-override after an LLM deny/reviewer failure.
      recordAudit(request, decision, undefined)
      const title = dshMessage(state.lang, decision.reviewerFailed ? 'deleteFailReviewerTitle' : 'deleteFailLlmTitle')
      const reason = decision.reason ?? dshMessage(state.lang, 'deleteFailDefaultReason')
      return { kind: 'ask', reason: `${title}${state.lang === 'zh' ? '；' : '; '}${reason}\n${dshMessage(state.lang, 'deleteRunAnyway')}` }
    }
    if (decision.kind === 'deny') {
      recordAudit(request, decision, 'block')
      return { kind: 'deny', reason: decision.reason ?? 'Denied by auto-guard' }
    }
    if (decision.kind === 'ask') {
      // DSH core: `ask` is serviced by `ctx.approval` when mounted; without an
      // approval UI it degrades to deny. That is our headless fail-closed path,
      // so no separate `headlessMode` switch is needed.
      recordAudit(request, decision, undefined)
      return { kind: 'ask', reason: decision.reason }
    }

    recordAudit(request, decision, 'allow')
    if (prepared.cleanedCommand !== undefined && (exec.name === 'bash' || exec.name === 'pwsh')) {
      const args = exec.arguments as Record<string, unknown> | null | undefined
      if (args && typeof args === 'object') {
        args.command = prepared.cleanedCommand
      }
    }
    return next() as Promise<PreToolDecision>
  }

  ctx.on('tools/pre-execute', ((rawExec: unknown, next: () => Promise<PreToolDecision | undefined>) => _preExecute(rawExec as ToolExecution, next)) as unknown as (payload: unknown) => void)

  const guard: ToolGuard = (exec) => {
    const request = toGuardRequest(exec as ExecutionLike)
    if (!request || !activeFor(exec)) return undefined
    return state.service.guardReason(request)
  }
  ctx.tools?.guard(guard as (exec: unknown) => string | undefined)

  // Session-scoped allow/deny memory must never leak into a new session.
  ctx.on('session/disposed', (raw) => {
    const session = raw as { id: string }
    state.service.clearSessionCache(session.id)
  })

  // Automatic learned-rule analysis: best-effort, never blocks session startup.
  ctx.on('session/created', () => {
    if (!state.config.autoAnalyzeEnabled || !state.config.examineEnabled) return
    const analysisState = loadAnalyzeState(state.config.analyzeStatePath)
    if (!shouldRunAutoAnalysis(analysisState, analysisIntervalMs(state.config))) return
    const timer = setTimeout(() => {
      const result = runLearnedAnalysis(state)
      if (!result.ok) {
        console.warn(`[auto-guard] auto analysis skipped: ${result.message}`)
      } else {
        console.info(`[auto-guard] ${result.message}`)
      }
    }, 0)
    timer.unref?.()
  })
}
