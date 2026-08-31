/**
 * Composition root shared by the PreToolUse hook entry, the management CLI
 * and the SessionStart entry — one per host, built from its descriptor
 * (ADR-0016).
 *
 * Host coupling allowed here only (ADR-0002): the descriptor's config root,
 * the disk session-state implementation (ADR-0004), the Light audit store
 * (ADR-0005, zero native dependencies for the plugin) and the API-key
 * hydration chain (ADR-0006).
 *
 * All session-scoped state comes from {@link loadDiskSessionState} so a guard
 * decision sees exactly what previous invocations in the same session saw.
 */
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendDecisionHistory as appendCore,
  readRecentDecisions as readCore,
  type RuntimeStatus,
  createAuditStore,
  DeepSeekReviewer,
  effectiveLang,
  envLang,
  FileTracker,
  GuardService,
  HistoryStore,
  hydrateApiKey,
  LightAuditStore,
  loadApiKey,
  loadAuditPassword,
  loadAnalyzeState,
  machineConfigPath,
  readMachineLang,
  shouldRunAutoAnalysis,
  analysisIntervalMs,
  loadRules,
  PersistentCache,
  createPendingSinks,
  createTrackerStore,
  DiskSessionCache,
  loadSessionState as loadDiskSessionState,
  classifyCommand,
  type Decision,
  type GuardConfig,
  type GuardRequest,
  type Lang,
  type RulesFile,
} from '@auto-guard/core'
import type { HostDescriptor } from './descriptor.ts'
import type { HostConfigSpace } from './config.ts'
import { createGuardService } from './guard-deps.ts'

export interface HostBootstrapKit {
  bootstrap(): GuardRuntime
  appendDecisionHistory(entry: RuntimeStatus): void
  readRecentDecisions(count?: number): RuntimeStatus[]
  readStatus(path?: string): RuntimeStatus
  writeStatus(status: RuntimeStatus, path?: string): void
  isDisabledByConfig(): boolean
  recordAudit(runtime: GuardRuntime, request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block'): void
  analysisDue(config: GuardConfig): boolean
  sessionIdFromEnv(): string | undefined
  workspaceFromEnv(fallback?: string): string | undefined
}

export interface GuardRuntime {
  config: GuardConfig
  rules: RulesFile
  service: GuardService
  reviewer: DeepSeekReviewer
  audit: LightAuditStore
  history?: HistoryStore
  sessionId?: string
  /** Effective output language, resolved once per process (ADR-0011). */
  lang: Lang
}

/** `home` roots the machine-default language file too (test fixture support). */
export function createBootstrap(descriptor: HostDescriptor, space: HostConfigSpace, home?: string): HostBootstrapKit {
  const machineHome = home ?? homedir()

  const firstEnv = (names: readonly string[]): string | undefined => {
    for (const name of names) {
      const value = process.env[name]
      if (value) return value
    }
    return undefined
  }

  /** Session/workspace identity injected by the host (descriptor env chains). */
  function sessionIdFromEnv(): string | undefined {
    return firstEnv(descriptor.envNames.session)
  }

  /**
   * Workspace identity: descriptor env chain first; `fallback` (SPEC 0015)
   * lets the hook pipeline hand in the payload's own `cwd` for hosts like
   * codex that inject no workspace env; `process.cwd()` stays the last resort.
   */
  function workspaceFromEnv(fallback?: string): string | undefined {
    return firstEnv(descriptor.envNames.workspace) ?? fallback ?? process.cwd()
  }

  /** Decision history ring for this host (200-line JSONL, pull-based). */
  const DECISION_HISTORY_PATH = () => join(space.autoGuardDir, 'decision-history.jsonl')

  function appendDecisionHistory(entry: RuntimeStatus, path = DECISION_HISTORY_PATH()): void {
    appendCore(entry, path)
  }

  function readRecentDecisions(count = 10, path = DECISION_HISTORY_PATH()): RuntimeStatus[] {
    return readCore(count, path)
  }

  function sessionsDir(): string {
    return join(space.autoGuardDir, 'sessions')
  }

  function bootstrap(): GuardRuntime {
    const config = hydrateApiKey(space.loadConfig(), () => loadApiKey(space.autoGuardDir))
    const lang = effectiveLang({
      env: envLang(),
      configLang: config.lang,
      machineLang: readMachineLang(machineConfigPath(machineHome)),
    })
    const rules = loadRules(config.rulesPath, config.defaultRulesPath)
    const sessionId = sessionIdFromEnv()
    const state = loadDiskSessionState(sessionsDir(), config.sessionCacheSize, sessionId)
    const persistentCache = new PersistentCache(config.cachePath)
    const llmReviewer = new DeepSeekReviewer(config, lang)
    const trackerStore = createTrackerStore(state.dir, config.fileTrackerWindowSec * 1000)
    const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000, trackerStore)
    const auditPassword = loadAuditPassword(space.autoGuardDir)
    // ADR-0005: the plugin ships without native dependencies; the Light
    // store (node:sqlite + field-level AES-GCM) is the intended implementation.
    const audit = new LightAuditStore(config.auditDbPath, auditPassword)
    const history = config.historyEnabled
      ? new HistoryStore({ dbPath: config.auditDbPath, password: auditPassword, days: config.historyDays })
      : undefined
    const { service } = createGuardService({
      config,
      rules,
      lang,
      sessionCache: state.cache,
      persistentCache,
      llmReviewer,
      fileTracker,
      historyStore: history,
        pendingPersistence: { directoryDeletes: state.sinks.directoryDeletes, denies: state.sinks.denies },
    })
    return { config, rules, service, reviewer: llmReviewer, audit, history, sessionId: state.sessionId, lang }
  }

  const STATUS_PATH = () => join(space.autoGuardDir, 'status.json')

  /** Best-effort status snapshot for `/guard status` (hook processes are short-lived). */
  function readStatus(path = STATUS_PATH()): RuntimeStatus {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as RuntimeStatus
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function writeStatus(status: RuntimeStatus, path = STATUS_PATH()): void {
    try {
      mkdirSync(space.autoGuardDir, { recursive: true })
      writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8' })
    } catch {
      // Status is cosmetic; never let it break a decision.
    }
  }

  /** True when config.json explicitly disables the guard (used by fail-safe path). */
  function isDisabledByConfig(): boolean {
    try {
      const configPath = join(space.autoGuardDir, 'config.json')
      if (!existsSync(configPath)) return false
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { enabled?: unknown }
      return parsed?.enabled === false
    } catch {
      return false
    }
  }

  /** Write one audit record when the experimental audit log is enabled. */
  function recordAudit(runtime: GuardRuntime, request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block'): void {
    if (!runtime.config.enabled || !runtime.config.examineEnabled) return
    if (request.tool !== 'bash' && request.tool !== 'pwsh') return
    if (typeof request.command !== 'string') return
    const rulePattern = classifyCommand(request.command, runtime.rules).rule?.pattern
    runtime.audit.insert({
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

  /** learned-rule cadence shared by hook + session-start entries (fail-open paths). */
  function analysisDue(config: GuardConfig): boolean {
    return config.examineEnabled && config.autoAnalyzeEnabled && shouldRunAutoAnalysis(loadAnalyzeState(config.analyzeStatePath), analysisIntervalMs(config))
  }

  return { bootstrap, appendDecisionHistory, readRecentDecisions, readStatus, writeStatus, isDisabledByConfig, recordAudit, analysisDue, sessionIdFromEnv, workspaceFromEnv }
}

// Re-exported so host facades can keep their pre-runtime bootstrap surface.
export type { RuntimeStatus }
