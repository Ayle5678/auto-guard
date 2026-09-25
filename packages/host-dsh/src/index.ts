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
import { join } from 'node:path'
import {
  analyzeLearnedRules,
  expandHome,
  GuardService,
  HistoryStore,
  loadAnalyzeState,
  loadLearnedRules,
  prepareDeletionMarker,
  recordToolCallAudit,
  resolveNotify,
  resolveProcessLang,
  rollbackLearnedRules,
  translateDecision,
  SessionLruCache,
  PersistentCache,
  SqlcipherAuditStore,
  LightAuditStore,
  createAuditStore,
  type AnalyzeMessage,
  type AuditStore,
  shouldRunAutoAnalysis,
  analysisIntervalMs,
  TemplateCache,
  loadRules,
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
import { createContextNotice, createPageNoticeEvents } from './notify-policy.ts'
import { dshMessage, type DshMessageKey } from './messages.ts'
import { DshLlmReviewer } from './dsh-reviewer.ts'
import { FileTracker } from '@auto-guard/core'
import { createGuardService } from '@auto-guard/host-runtime'
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
  const lang = resolveProcessLang(config.lang)
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
  // GuardDeps wiring is the shared runtime assembly (ADR-0016); the in-memory
  // session state and the audit-store choice stay dsh's own.
  const { service, learned, templateCache } = createGuardService({
    config,
    rules,
    lang,
    sessionCache,
    persistentCache,
    llmReviewer,
    fileTracker,
    historyStore: history,
  })
  return { config, rules, service, audit, history, learned, templateCache, lang }
}

/** DSH wording for the analyze receipts (settings page); both done variants share one line. */
const dshAnalyzeWording: AnalyzeMessage = (lang, key, params = {}) => {
  if (key === 'analyzeNeedsExamine') return dshMessage(lang, 'analyzeNeedsExamine')
  if (key === 'analyzeNeedsPassword') return dshMessage(lang, 'analyzeNeedsPassword')
  return dshMessage(lang, 'analyzeDone', { count: params.count })
}

/** Reload learned rules into the in-memory state after a write (analysis or rollback). */
function refreshLearned(state: GuardState): void {
  state.learned = loadLearnedRules(state.config.learnedRulesPath, [...state.rules.hardDeny, ...state.rules.alwaysReview, ...state.rules.directoryDelete])
  state.templateCache.setCacheablePatterns(state.learned.cacheable)
}

/**
 * One learned-rule analysis through the core operation (ADR-0024): always
 * full — today's DSH behavior made an explicit parameter — with the audit
 * password gate and DSH receipt wording in place.
 */
function runAnalysis(state: GuardState): { ok: boolean; message: string } {
  const result = analyzeLearnedRules(
    { config: state.config, rules: state.rules, audit: state.audit },
    state.lang,
    { full: true, passwordGate: true, message: dshAnalyzeWording },
  )
  if (result.ok) refreshLearned(state)
  return result
}

/** Remote service exposed to the settings page via Typert Remote. */
function createAutoGuardRemote(state: GuardState): Record<string, unknown> {
  const t = (key: DshMessageKey, params: Record<string, string | number> = {}) => dshMessage(state.lang, key, params)
  const service = {
    analyzeNow(): { ok: boolean; message: string } {
      return runAnalysis(state)
    },
    listRules(): ReturnType<typeof loadLearnedRules> {
      return state.learned
    },
    rollback(): { ok: boolean; message: string } {
      const result = rollbackLearnedRules(state.config, state.lang)
      if (result.ok) refreshLearned(state)
      return result
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
        ? { ok: true, message: t('exportDone', { path: '~/.dsh/auto-guard/audit.export.db' }) }
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

  /** Write one audit record; the audit-password gate is DSH's own (fronted per ADR-0025), the record policy lives in core. */
  function recordAudit(request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block' | undefined): void {
    if (!state.config.auditPassword) return
    // `enabled` is DSH's never-persisted constant (the permission preset is
    // the only switch); pinning it true preserves DSH's historical gate set.
    recordToolCallAudit(state.audit, state.rules, request, decision, finalAction, { enabled: true, examineEnabled: state.config.examineEnabled })
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

  /** Deliver the notification on the core-resolved route; DSH's sinks are session inject (context) and page events. */
  function notify(exec: ToolExecution, decision: Decision): void {
    if (!exec.agent) return
    const route = resolveNotify(decision, state.config, DSH_CAPABILITIES)
    if (route === 'context') {
      const message = createContextNotice(decision, state.lang)
      try {
        exec.agent.session?.inject?.(message)
      } catch {
        // Notification is best-effort; never fail the tool call because of it.
      }
      return
    }
    if (route !== 'page') return

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
    const translation = translateDecision(decision, DSH_CAPABILITIES)

    // Directory delete, first hit: block once so the AGENT supplies a
    // `[删除理由] <reason>` marker on retry. The agent authors the reason;
    // the LLM reviews it; the human only appears for ask/deny outcomes.
    if (translation.needsReason) {
      recordAudit(request, decision, 'block')
      return { kind: 'deny', reason: decision.reason ?? 'Directory deletion requires a reason' }
    }

    if (translation.needsHumanVeto) {
      // DSH has no plugin-owned confirm dialog; route this through `ask` so
      // the human can still veto-override after an LLM deny/reviewer failure.
      recordAudit(request, decision, undefined)
      const title = dshMessage(state.lang, translation.vetoTitleKey)
      const reason = decision.reason ?? dshMessage(state.lang, 'deleteFailDefaultReason')
      return { kind: 'ask', reason: `${title}${state.lang === 'zh' ? '；' : '; '}${reason}\n${dshMessage(state.lang, 'deleteRunAnyway')}` }
    }
    if (translation.action === 'deny') {
      recordAudit(request, decision, 'block')
      return { kind: 'deny', reason: decision.reason ?? 'Denied by auto-guard' }
    }
    if (translation.action === 'ask') {
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
      const result = runAnalysis(state)
      if (!result.ok) {
        console.warn(`[auto-guard] auto analysis skipped: ${result.message}`)
      } else {
        console.info(`[auto-guard] ${result.message}`)
      }
    }, 0)
    timer.unref?.()
  })
}
