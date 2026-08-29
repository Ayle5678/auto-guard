/**
 * Composition root for the spawned hook CLI and the management CLI
 * (opencode mirror of the zcode/claude bootstrap).
 *
 * Host coupling allowed here only (ADR-0002). The guard never runs inside
 * OpenCode's bun process — every decision spawns `node dist/hook-cli.js`
 * (ADR-0011), so all state must live on disk to survive process boundaries.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendDecisionHistory as appendCore,
  readRecentDecisions as readCore,
  type RuntimeStatus,
  createAuditStore,
  DeepSeekReviewer,
  FileTracker,
  GuardService,
  type GuardDeps,
  HistoryStore,
  hydrateApiKey,
  LightAuditStore,
  loadApiKey,
  loadAuditPassword,
  loadLearnedRules,
  loadAnalyzeState,
  shouldRunAutoAnalysis,
  analysisIntervalMs,
  loadRules,
  PersistentCache,
  createPendingSinks,
  createTrackerStore,
  DiskSessionCache,
  loadSessionState as loadDiskSessionState,
  TemplateCache,
  classifyCommand,
  type AuditStore,
  type Decision,
  type GuardConfig,
  type GuardRequest,
  type RulesFile,
} from '@auto-guard/core'
import { AUTO_GUARD_DIR, loadConfig } from './config.ts'

/** Session identity comes from the event payload; this env chain only steers the disk state directory. */
export function sessionIdFromEnv(): string | undefined {
  return process.env.OPENCODE_SESSION_ID
}

export function workspaceFromEnv(): string | undefined {
  return process.env.OPENCODE_WORKTREE ?? process.cwd()
}

/** Decision history ring for this host (200-line JSONL, pull-based). */
const DECISION_HISTORY_PATH = () => join(AUTO_GUARD_DIR, 'decision-history.jsonl')

export function appendDecisionHistory(entry: RuntimeStatus, path = DECISION_HISTORY_PATH()): void {
  appendCore(entry, path)
}

export function readRecentDecisions(count = 10, path = DECISION_HISTORY_PATH()): RuntimeStatus[] {
  return readCore(count, path)
}

export interface GuardRuntime {
  config: GuardConfig
  rules: RulesFile
  service: GuardService
  reviewer: DeepSeekReviewer
  audit: LightAuditStore
  history?: HistoryStore
  sessionId?: string
}

export function bootstrap(): GuardRuntime {
  const config = hydrateApiKey(loadConfig(), () => loadApiKey(AUTO_GUARD_DIR))
  const rules = loadRules(config.rulesPath, config.defaultRulesPath)
  const sessionId = sessionIdFromEnv()
  const state = loadDiskSessionState(sessionsDir(), config.sessionCacheSize, sessionId)
  const persistentCache = new PersistentCache(config.cachePath)
  const llmReviewer = new DeepSeekReviewer(config)
  const trackerStore = createTrackerStore(state.dir, config.fileTrackerWindowSec * 1000)
  const fileTracker = new FileTracker(config.fileTrackerWindowSec * 1000, trackerStore)
  const auditPassword = loadAuditPassword(AUTO_GUARD_DIR)
  const audit = new LightAuditStore(config.auditDbPath, auditPassword)
  const history = config.historyEnabled
    ? new HistoryStore({ dbPath: config.auditDbPath, password: auditPassword, days: config.historyDays })
    : undefined
  const learned = loadLearnedRules(config.learnedRulesPath, [...rules.hardDeny, ...rules.alwaysReview, ...rules.directoryDelete])
  const templateCache = new TemplateCache(config.templateCachePath)
  templateCache.setCacheablePatterns(learned.cacheable)
  const deps: GuardDeps = {
    config,
    rules,
    sessionCache: state.cache,
    persistentCache,
    llmReviewer,
    fileTracker,
    historyStore: history,
    templateCache,
    pendingPersistence: { directoryDeletes: state.sinks.directoryDeletes, denies: state.sinks.denies },
  }
  return { config, rules, service: new GuardService(deps), reviewer: llmReviewer, audit, history, sessionId: state.sessionId }
}

function sessionsDir(): string {
  return join(AUTO_GUARD_DIR, 'sessions')
}

/** Best-effort status snapshot for `guard status` (hook processes are short-lived). */
export type { RuntimeStatus }

const STATUS_PATH = () => join(AUTO_GUARD_DIR, 'status.json')

export function readStatus(path = STATUS_PATH()): RuntimeStatus {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RuntimeStatus
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeStatus(status: RuntimeStatus, path = STATUS_PATH()): void {
  try {
    mkdirSync(AUTO_GUARD_DIR, { recursive: true })
    writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8' })
  } catch {
    // Status is cosmetic; never let it break a decision.
  }
}

/** True when config.json explicitly disables the guard (used by fail-safe path). */
export function isDisabledByConfig(): boolean {
  try {
    const configPath = join(AUTO_GUARD_DIR, 'config.json')
    if (!existsSync(configPath)) return false
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { enabled?: unknown }
    return parsed?.enabled === false
  } catch {
    return false
  }
}

/** Write one audit record when the experimental audit log is enabled. */
export function recordAudit(runtime: GuardRuntime, request: GuardRequest, decision: Decision, finalAction: 'allow' | 'block'): void {
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
