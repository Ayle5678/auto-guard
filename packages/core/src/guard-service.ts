/**
 * GuardService — the single testable seam for auto-guard.
 *
 * `decide()` runs the layered decision pipeline for one normalized execution;
 * the host adapters' event handlers are thin wrappers over it. All I/O (rules, caches, LLM, file system) is injected so unit tests never
 * touch the network or real home directory.
 */
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  buildSessionKey,
  buildWorkspaceKey,
  entryForDecision,
  PersistentCache,
  ttlForRisk,
  type AllowDenyDecision,
  type CacheEntry,
  type SessionCacheLike,
} from './cache.ts'
import { containsShellOperators, expandHome, hasCommandSubstitution, isHighRiskStateChangingCommand, isLowRiskStateChangingCommand, normalizeCommand, splitShellCommand } from './command.ts'
import { FileTracker } from './file-tracker.ts'
import { PersistableMap, type JsonSink } from './persist-map.ts'
import type { HistoryStore } from './history.ts'
import type { TemplateCache } from './template-cache.ts'
import type { LlmReviewer } from './llm.ts'
import type { RiskLevel, RulesFile } from './types.ts'
import { classifyCommand, containsDangerousPattern, staticAllowGuardHit, type Classification } from './rules.ts'
import { matchesSensitivePath, shellCommandHasSensitivePath } from './sensitive-path.ts'
import type { Lang } from './lang.ts'
import { langOf } from './lang.ts'
import { coreMessage } from './messages.ts'
import type { Decision, GuardConfig, GuardRequest, LlmReviewResult } from './types.ts'

export interface PendingPersistence {
  /** Sink mirroring first-hit directory-delete denials (hook model survives process restarts). */
  directoryDeletes?: JsonSink
  /** Sink mirroring LLM deny records awaiting a user repeat-confirmation. */
  denies?: JsonSink
}

export interface GuardDeps {
  config: GuardConfig
  rules: RulesFile
  sessionCache: SessionCacheLike
  persistentCache: PersistentCache
  llmReviewer: LlmReviewer
  fileTracker: FileTracker
  historyStore?: HistoryStore
  templateCache?: TemplateCache
  pendingPersistence?: PendingPersistence
  /** Effective output language for engine-authored reasons (four-layer resolved by the host; default zh). */
  lang?: Lang
}

export interface GuardStats {
  llmCalls: number
  sessionCacheHits: number
  persistentCacheHits: number
  historyHits: number
  learnedHits: number
  ruleHits: Record<'static-allow' | 'user-confirmed' | 'hard-deny' | 'directory-delete' | 'file-tracker' | 'sensitive-path', number>
}

function mergeRisk(risks: Array<RiskLevel | undefined>): RiskLevel | undefined {
  let merged: RiskLevel | undefined
  for (const risk of risks) {
    if (!risk) continue
    if (!merged) merged = risk
    else if (risk === 'high' || (risk === 'medium' && merged === 'low')) merged = risk
  }
  return merged
}

function createStats(): GuardStats {
  return {
    llmCalls: 0,
    sessionCacheHits: 0,
    persistentCacheHits: 0,
    historyHits: 0,
    learnedHits: 0,
    ruleHits: {
      'static-allow': 0,
      'user-confirmed': 0,
      'hard-deny': 0,
      'directory-delete': 0,
      'file-tracker': 0,
      'sensitive-path': 0,
    },
  }
}

export class GuardService {
  private readonly config: GuardConfig
  private readonly rules: RulesFile
  private readonly sessionCache: SessionCacheLike
  private readonly persistentCache: PersistentCache
  private readonly llmReviewer: LlmReviewer
  private readonly fileTracker: FileTracker
  private readonly historyStore?: HistoryStore
  private readonly templateCache?: TemplateCache
  private readonly lang: Lang
  private readonly pendingDirectoryDeletes: PersistableMap<{ deniedAt: number }>
  private readonly pendingDenies: PersistableMap<RiskLevel | undefined>
  readonly stats: GuardStats = createStats()

  constructor(deps: GuardDeps) {
    this.config = deps.config
    this.rules = deps.rules
    this.sessionCache = deps.sessionCache
    this.persistentCache = deps.persistentCache
    this.llmReviewer = deps.llmReviewer
    this.fileTracker = deps.fileTracker
    this.historyStore = deps.historyStore
    this.templateCache = deps.templateCache
    this.lang = deps.lang ?? langOf(deps.config)
    this.pendingDirectoryDeletes = new PersistableMap(deps.pendingPersistence?.directoryDeletes)
    this.pendingDenies = new PersistableMap(deps.pendingPersistence?.denies)
  }

  /** Clear session-scoped memory (called on session shutdown). */
  clearSessionCache(session?: string): void {
    if (session) {
      this.sessionCache.clearSession(session)
      const prefix = `${session}|`
      for (const key of this.pendingDenies.keys()) {
        if (key.startsWith(prefix)) this.pendingDenies.delete(key)
      }
    } else {
      this.sessionCache.clear()
      this.pendingDenies.clear()
    }
  }

  /** Reset in-memory stats (called at session start). */
  resetStats(): void {
    this.stats.llmCalls = 0
    this.stats.sessionCacheHits = 0
    this.stats.persistentCacheHits = 0
    this.stats.historyHits = 0
    this.stats.learnedHits = 0
    this.stats.ruleHits['static-allow'] = 0
    this.stats.ruleHits['user-confirmed'] = 0
    this.stats.ruleHits['hard-deny'] = 0
    this.stats.ruleHits['directory-delete'] = 0
    this.stats.ruleHits['file-tracker'] = 0
    this.stats.ruleHits['sensitive-path'] = 0
  }

  /** Write a user-chosen session memory entry (ask four-state), alive until session end. */
  rememberAsk(request: GuardRequest, command: string, decision: { kind: 'allow' | 'deny'; reason?: string }): void {
    const entry: CacheEntry = {
      decision: decision.kind,
      reason: decision.reason,
      cachedAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
    }
    this.sessionCache.set(buildSessionKey(request.session, request.workspace, command), entry)
  }

  /**
   * Synchronous monotonic guard: returns a denial reason only for absolute
   * blacklist hits. Safe to call from a synchronous context.
   */
  guardReason(request: GuardRequest): string | undefined {
    if (request.tool !== 'bash' && request.tool !== 'pwsh') return undefined
    if (typeof request.command !== 'string') return undefined
    const classification = classifyCommand(request.command, this.rules)
    if (classification.category === 'hard-deny') {
      return classification.rule?.reason ?? 'Blocked by absolute blacklist'
    }
    return undefined
  }

  /** Session id used in notifications; never sent to the LLM. */
  sessionIdOf(request: GuardRequest): string | undefined {
    return request.session
  }

  /**
   * Full decision pipeline. See the class doc for ordering.
   */
  async decide(request: GuardRequest): Promise<Decision> {
    const decision = await this.decideRaw(request)
    this.recordRuleHit(decision)
    if (decision.source === 'llm' && decision.kind === 'deny' && !decision.reviewerFailed && typeof decision.command === 'string') {
      this.recordPendingDeny(request, decision.command, decision.risk)
    }
    return decision
  }

  private async decideRaw(request: GuardRequest): Promise<Decision> {
    if (request.tool === 'write' || request.tool === 'edit' || request.tool === 'read') {
      return this.decideFile(request)
    }
    if (request.tool === 'bash' || request.tool === 'pwsh') {
      return this.decideShell(request)
    }
    // Tools outside guard scope pass through untouched.
    return { kind: 'allow', source: 'passthrough' }
  }

  private recordRuleHit(decision: Decision): void {
    switch (decision.source) {
      case 'static-allow': this.stats.ruleHits['static-allow']++
        break
      case 'user-confirmed': this.stats.ruleHits['user-confirmed']++
        break
      case 'hard-deny': this.stats.ruleHits['hard-deny']++
        break
      case 'directory-delete': this.stats.ruleHits['directory-delete']++
        break
      case 'file-tracker': this.stats.ruleHits['file-tracker']++
        break
      case 'sensitive-path': this.stats.ruleHits['sensitive-path']++
        break
      case 'history': this.stats.historyHits++
        break
      case 'learned': this.stats.learnedHits++
        break
    }
  }

  private decideFile(request: GuardRequest): Decision {
    const path = expandHome(request.filePath ?? '')
    const sensitive = this.rules.sensitivePaths
    if (path && sensitive.some((pattern) => matchesSensitivePath(path, pattern))) {
      return {
        kind: 'ask',
        source: 'sensitive-path',
        reason: `Path is on the sensitive list, confirmation required: ${path}`,
      }
    }
    return { kind: 'allow', source: 'passthrough' }
  }

  /** Shell decision: file tracker gate is first, then rules, caches, LLM. */
  private async decideShell(request: GuardRequest): Promise<Decision> {
    if (typeof request.command !== 'string') return { kind: 'deny', source: 'error', reason: 'Missing command' }
    const command = normalizeCommand(request.command)

    // File tracker first as a safety override (never bypassed by allowlists).
    const trackerHit = this.fileTracker.evaluate(command)
    if (trackerHit) {
      const materialized = await this.fileTracker.materialize(trackerHit, this.rules.sensitivePaths)
      if (materialized.sensitiveContent || materialized.content === undefined) {
        return this.fileTrackerDefault(materialized.scriptPath)
      }
      return this.llmDecision(request, { command, script: materialized.content }, 'file-tracker')
    }

    const classification = classifyCommand(command, this.rules)

    if (classification.category === 'hard-deny') {
      return { kind: 'deny', source: 'hard-deny', category: 'hard-deny', reason: classification.rule?.reason ?? 'Blocked by absolute blacklist' }
    }
    if (classification.category === 'directory-delete') {
      return this.decideDirectoryDelete(request, command)
    }

    // Shell sensitive-path guard: before any static/compound/pipeline allow, if
    // the command references a configured sensitive path, demote the whole
    // command to LLM review rather than silently reading secrets.
    if (shellCommandHasSensitivePath(command, this.rules.sensitivePaths)) {
      return this.llmDecision(request, { command }, 'llm')
    }

    const segments = splitShellCommand(command)
    if (segments.length > 1) {
      return this.decideCompound(request, command, segments)
    }

    // Pure pipelines (no `;`/`&&`/`||`) are judged as one unit: every leaf must
    // be deterministically safe before the pipeline is allowed.
    const pipelineLeaves = splitShellCommand(command, true)
    if (pipelineLeaves.length > 1) {
      return this.decidePipeline(request, command, pipelineLeaves)
    }

    if (this.isRemoveItem(command)) {
      const targetType = await this.removeItemTargetType(request, command)
      if (targetType === 'directory') {
        return this.decideDirectoryDelete(request, command)
      }
      if (targetType === 'unknown') {
        return this.llmDecision(request, { command }, 'llm')
      }
    }
    // Shell substitution ($(), backticks, <(), >()) executes before the named
    // program runs; pipes/redirects carry side effects a wildcard tail would
    // swallow. Either way wildcard allowlist hits are not trustworthy — send
    // these to the LLM instead.
    const bypassesStatic = hasCommandSubstitution(command) || containsShellOperators(command)
    if (!bypassesStatic && (classification.category === 'static-allow' || classification.category === 'user-confirmed')) {
      const sessionKey = buildSessionKey(request.session, request.workspace, command)
      const sessionEntry = this.sessionCache.get(sessionKey)
      if (sessionEntry) {
        this.stats.sessionCacheHits++
        return this.fromCache(sessionEntry, 'session-cache')
      }
      if (classification.category === 'static-allow') {
        if (staticAllowGuardHit(command, this.rules)) {
          return this.llmDecision(request, { command }, 'llm')
        }
        return { kind: 'allow', source: 'static-allow', category: 'static-allow', reason: classification.rule?.reason }
      }
      if (staticAllowGuardHit(command, this.rules)) {
        return this.llmDecision(request, { command }, 'llm')
      }
      return { kind: 'allow', source: 'user-confirmed', category: 'user-confirmed', reason: classification.rule?.reason }
    }

    // Cacheable and low/medium-risk unknown commands may be served from cache;
    // always-review commands use only the short-lived session cache.
    if (classification.category === 'always-review') {
      const sessionKey = buildSessionKey(request.session, request.workspace, command)
      const sessionEntry = this.sessionCache.get(sessionKey)
      if (sessionEntry) {
        this.stats.sessionCacheHits++
        return this.fromCache(sessionEntry, 'session-cache')
      }
    }
    if (classification.category === 'cacheable' || classification.category === 'unknown') {
      const cached = this.cacheHit(request, command)
      if (cached) return cached
    }

    const template = this.templateCacheDecision(command)
    if (template) return template

    const history = this.historyDecision(request, command)
    if (history) return history

    const decision = await this.llmDecision(request, { command }, 'llm')

    if (classification.category === 'always-review' && decision.kind === 'allow' && decision.risk !== 'high') {
      this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason }, this.config.alwaysReviewCacheTtlMinutes * 60 * 1000)
    }
    if ((classification.category === 'cacheable' || classification.category === 'unknown') && decision.kind === 'allow' && decision.risk !== 'high') {
      this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason })
    }
    if ((classification.category === 'cacheable' || classification.category === 'unknown') && decision.kind === 'allow' && decision.risk !== 'high') {
      this.writePersistentCache(request, command, { kind: 'allow', risk: decision.risk, reason: decision.reason })
    }

    return decision
  }

  /**
   * Pipeline (`|`) decision: hard-deny/directory-delete precedence, sensitive-path
   * demotion, then allow only when every leaf is deterministically safe. Any
   * leaf that needs LLM judgment sends the whole pipeline to the LLM — never a
   * per-leaf LLM call, so the model sees the full data flow.
   */
  private async decidePipeline(request: GuardRequest, command: string, leaves: string[]): Promise<Decision> {
    // First pass: absolute blacklist and directory-delete flows must win before
    // any whole-pipeline session memory or LLM review happens.
    for (const leaf of leaves) {
      const classification = classifyCommand(leaf, this.rules)
      if (classification.category === 'hard-deny') {
        return { kind: 'deny', source: 'hard-deny', category: 'hard-deny', reason: classification.rule?.reason ?? 'Blocked by absolute blacklist' }
      }
      if (classification.category === 'directory-delete') {
        return this.decideDirectoryDelete(request, command)
      }
      if (this.isRemoveItem(leaf)) {
        const targetType = await this.removeItemTargetType(request, leaf)
        if (targetType === 'directory') {
          return this.decideDirectoryDelete(request, command)
        }
      }
    }

    // A whole-pipeline session memory (from an ask four-state choice) applies
    // before per-leaf analysis.
    const wholeSessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, command))
    if (wholeSessionEntry) {
      this.stats.sessionCacheHits++
      return this.fromCache(wholeSessionEntry, 'session-cache')
    }

    // A previously denied leaf turns the whole pipeline into an ask before a
    // whole-pipeline persistent allow can mask it.
    for (const leaf of leaves) {
      const pending = this.pendingDenyDecision(request, leaf)
      if (pending) {
        return { ...pending, command }
      }
    }

    // Preserve the existing whole-command cache behavior for pipelines that
    // have already been reviewed and cached as one unit.
    const wholeCached = this.cacheHit(request, command)
    if (wholeCached) return wholeCached

    const template = this.templateCacheDecision(command)
    if (template) return template

    const history = this.historyDecision(request, command)
    if (history) return history

    let sawSessionCache = false
    let sawPersistentCache = false
    let sawUserConfirmed = false
    const reasons: string[] = []
    const risks: Array<RiskLevel | undefined> = []

    for (const leaf of leaves) {
      const classification = classifyCommand(leaf, this.rules)

      // Per-leaf session memory is honored for allow/deny choices.
      const sessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, leaf))
      if (sessionEntry) {
        this.stats.sessionCacheHits++
        if (sessionEntry.decision !== 'allow') return this.fromCache(sessionEntry, 'session-cache')
        sawSessionCache = true
        risks.push(sessionEntry.risk)
        reasons.push(sessionEntry.reason ?? leaf)
        continue
      }

      const plainSafe =
        (classification.category === 'static-allow' || classification.category === 'user-confirmed') &&
        !hasCommandSubstitution(leaf) &&
        !containsShellOperators(leaf) &&
        !containsDangerousPattern(leaf, this.rules) &&
        !staticAllowGuardHit(leaf, this.rules)
      if (plainSafe) {
        if (classification.category === 'user-confirmed') sawUserConfirmed = true
        reasons.push(classification.rule?.reason ?? leaf)
        continue
      }

      // Already-approved unknown/cacheable leaves may count as deterministic
      // only when an existing cache entry says allow.
      const cached = this.cacheHit(request, leaf)
      if (cached) {
        if (cached.kind !== 'allow') return cached
        if (cached.source === 'session-cache') sawSessionCache = true
        if (cached.source === 'persistent-cache') sawPersistentCache = true
        risks.push(cached.risk)
        reasons.push(cached.reason ?? leaf)
        continue
      }

      // Any leaf that needs judgment sends the whole pipeline to the LLM.
      const wholeClassification = classifyCommand(command, this.rules)
      const decision = await this.llmDecision(request, { command }, 'llm')

      if (wholeClassification.category === 'always-review' && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason }, this.config.alwaysReviewCacheTtlMinutes * 60 * 1000)
      }
      if ((wholeClassification.category === 'cacheable' || wholeClassification.category === 'unknown') && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason })
      }
      if ((wholeClassification.category === 'cacheable' || wholeClassification.category === 'unknown') && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writePersistentCache(request, command, { kind: 'allow', risk: decision.risk, reason: decision.reason })
      }

      return decision
    }

    const source = sawSessionCache
      ? 'session-cache'
      : sawPersistentCache
        ? 'persistent-cache'
        : sawUserConfirmed
          ? 'user-confirmed'
          : 'static-allow'

    const risk = mergeRisk(risks)
    return {
      kind: 'allow',
      source,
      category: source === 'static-allow' ? 'static-allow' : source === 'user-confirmed' ? 'user-confirmed' : 'cacheable',
      ...(risk ? { risk } : {}),
      reason: `All pipeline stages approved: ${reasons.join('; ')}`,
    }
  }

  /**
   * Compound command (`;`, `&&`, `||`) decision: each subcommand is checked
   * independently against rules/cache, and only unmatched subcommands are sent
   * to the LLM. Pipelines are never split here (see splitShellCommand).
   */
  private async decideCompound(request: GuardRequest, command: string, segments: string[]): Promise<Decision> {
    // First pass: absolute blacklist and directory-delete flows must win before
    // any per-subcommand LLM review happens.
    for (const segment of segments) {
      const classification = classifyCommand(segment, this.rules)
      if (classification.category === 'hard-deny') {
        return { kind: 'deny', source: 'hard-deny', category: 'hard-deny', reason: classification.rule?.reason ?? 'Blocked by absolute blacklist' }
      }
      if (classification.category === 'directory-delete') {
        return this.decideDirectoryDelete(request, command)
      }
      if (this.isRemoveItem(segment)) {
        const targetType = await this.removeItemTargetType(request, segment)
        if (targetType === 'directory') {
          return this.decideDirectoryDelete(request, command)
        }
      }
    }

    // A whole-compound session memory (from an ask four-state choice) applies
    // before any whole-compound LLM review path.
    const wholeSessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, command))
    if (wholeSessionEntry) {
      this.stats.sessionCacheHits++
      return this.fromCache(wholeSessionEntry, 'session-cache')
    }

    // A previously denied subcommand turns the whole compound into an ask
    // before any whole-compound LLM review, unless session memory already
    // covers that subcommand.
    for (const segment of segments) {
      const pending = this.pendingDenyForParts(request, segment)
      if (pending) {
        return { ...pending, command }
      }
    }

    const template = this.templateCacheDecision(command)
    if (template) return template

    const history = this.historyDecision(request, command)
    if (history) return history

    // High-risk state changers (alias, source, exec, trap, config writes, ...)
    // can hijack later subcommands or persist config, so the whole compound is
    // reviewed by the LLM instead of approving subcommands independently.
    if (segments.some((segment) => isHighRiskStateChangingCommand(segment))) {
      return this.llmDecision(request, { command }, 'llm')
    }

    // Low-risk state changers (cd/pushd/popd) are only allowed when every
    // segment is either low-risk navigation or a plain static-allow command,
    // with no embedded substitution/operators and no dangerous content (even
    // quoted). Anything else keeps the whole-compound LLM review so the model
    // sees full context.
    if (segments.some((segment) => isLowRiskStateChangingCommand(segment))) {
      let allPlainSafe = true
      for (const segment of segments) {
        const classification = classifyCommand(segment, this.rules)
        const sessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, segment))
        if (sessionEntry) {
          if (sessionEntry.decision !== 'allow') {
            this.stats.sessionCacheHits++
            return this.fromCache(sessionEntry, 'session-cache')
          }
          // Allow hits are counted again in the per-segment loop when they actually
          // contribute to the final compound decision.
          continue
        }
        const plainStaticAllow =
          classification.category === 'static-allow' &&
          !hasCommandSubstitution(segment) &&
          !containsShellOperators(segment) &&
          !containsDangerousPattern(segment, this.rules) &&
          !staticAllowGuardHit(segment, this.rules)
        const lowRiskNavigation =
          isLowRiskStateChangingCommand(segment) &&
          !hasCommandSubstitution(segment) &&
          !containsShellOperators(segment) &&
          !containsDangerousPattern(segment, this.rules)
        if (!plainStaticAllow && !lowRiskNavigation) {
          allPlainSafe = false
          break
        }
      }
      if (!allPlainSafe) {
        return this.llmDecision(request, { command }, 'llm')
      }
    }

    let sawLlm = false
    let sawSessionCache = false
    let sawPersistentCache = false
    let sawUserConfirmed = false
    const reasons: string[] = []
    const risks: Array<RiskLevel | undefined> = []

    for (const segment of segments) {
      const classification = classifyCommand(segment, this.rules)

      const segmentBypassesStatic = hasCommandSubstitution(segment) || containsShellOperators(segment)
      if (
        isLowRiskStateChangingCommand(segment) &&
        !segmentBypassesStatic &&
        !containsDangerousPattern(segment, this.rules)
      ) {
        reasons.push('directory navigation')
        continue
      }
      if (classification.category === 'static-allow' && !segmentBypassesStatic) {
        const sessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, segment))
        if (sessionEntry) {
          this.stats.sessionCacheHits++
          if (sessionEntry.decision !== 'allow') return this.fromCache(sessionEntry, 'session-cache')
          sawSessionCache = true
          risks.push(sessionEntry.risk)
          reasons.push(sessionEntry.reason ?? segment)
          continue
        }
        if (staticAllowGuardHit(segment, this.rules)) {
          return this.llmDecision(request, { command }, 'llm')
        }
        reasons.push(classification.rule?.reason ?? segment)
        continue
      }
      if (classification.category === 'user-confirmed' && !segmentBypassesStatic) {
        const sessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, segment))
        if (sessionEntry) {
          this.stats.sessionCacheHits++
          if (sessionEntry.decision !== 'allow') return this.fromCache(sessionEntry, 'session-cache')
          sawSessionCache = true
          risks.push(sessionEntry.risk)
          reasons.push(sessionEntry.reason ?? segment)
          continue
        }
        if (staticAllowGuardHit(segment, this.rules)) {
          return this.llmDecision(request, { command }, 'llm')
        }
        sawUserConfirmed = true
        reasons.push(classification.rule?.reason ?? segment)
        continue
      }

      // always-review subcommands use only the short-lived session cache.
      const alwaysReviewSegment = classification.category === 'always-review'
      if (alwaysReviewSegment) {
        const sessionKey = buildSessionKey(request.session, request.workspace, segment)
        const sessionEntry = this.sessionCache.get(sessionKey)
        if (sessionEntry) {
          this.stats.sessionCacheHits++
          if (sessionEntry.decision !== 'allow') return this.fromCache(sessionEntry, 'session-cache')
          sawSessionCache = true
          risks.push(sessionEntry.risk)
          reasons.push(sessionEntry.reason ?? segment)
          continue
        }
      }

      // cacheable and unknown subcommands may use the dynamic cache.
      const cacheableSegment = classification.category === 'cacheable' || classification.category === 'unknown'
      if (cacheableSegment) {
        const cached = this.cacheHit(request, segment)
        if (cached) {
          if (cached.kind !== 'allow') return cached
          if (cached.source === 'session-cache') sawSessionCache = true
          if (cached.source === 'persistent-cache') sawPersistentCache = true
          risks.push(cached.risk)
          reasons.push(cached.reason ?? segment)
          continue
        }
      }

      const decision = await this.llmDecision(request, { command: segment }, 'llm')

      if (alwaysReviewSegment && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writeSessionCache(request, segment, { kind: decision.kind, risk: decision.risk, reason: decision.reason }, this.config.alwaysReviewCacheTtlMinutes * 60 * 1000)
      }
      if (cacheableSegment && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writeSessionCache(request, segment, { kind: decision.kind, risk: decision.risk, reason: decision.reason })
      }
      if (cacheableSegment && decision.kind === 'allow' && decision.risk !== 'high') {
        this.writePersistentCache(request, segment, { kind: 'allow', risk: decision.risk, reason: decision.reason })
      }

      if (decision.kind !== 'allow') return decision
      sawLlm = true
      risks.push(decision.risk)
      reasons.push(decision.reason ?? segment)
    }

    const source = sawLlm
      ? 'llm'
      : sawSessionCache || sawPersistentCache
        ? sawSessionCache ? 'session-cache' : 'persistent-cache'
        : sawUserConfirmed
          ? 'user-confirmed'
          : 'static-allow'

    const risk = mergeRisk(risks)
    return {
      kind: 'allow',
      source,
      category: source === 'static-allow' ? 'static-allow' : source === 'user-confirmed' ? 'user-confirmed' : 'cacheable',
      ...(risk ? { risk } : {}),
      reason: `All subcommands approved: ${reasons.join('; ')}`,
    }
  }

  private async decideDirectoryDelete(request: GuardRequest, command: string): Promise<Decision> {
    const key = buildSessionKey(request.session, request.workspace, command.toLowerCase())
    const pending = this.pendingDirectoryDeletes.get(key)
    if (!pending) {
      this.pendingDirectoryDeletes.set(key, { deniedAt: Date.now() })
      return {
        kind: 'deny',
        source: 'directory-delete',
        category: 'directory-delete',
        needsReason: true,
        reason: 'Directory deletion requires a reason. Retry the same command with a `[删除理由] <reason>` marker appended.',
      }
    }

    const reason = this.extractDeletionReason(request, pending.deniedAt)
    if (!reason) {
      return {
        kind: 'deny',
        source: 'directory-delete',
        category: 'directory-delete',
        needsReason: true,
        reason: 'No [删除理由] found after the previous denial. Retry the same command with a `[删除理由] <reason>` marker appended.',
      }
    }

    const decision = await this.llmDecision(
      request,
      { command, deletionReason: reason, reasoningEffort: 'low' },
      'llm',
      false,
    )

    // Single review per pending delete. Non-allow outcomes are resolved by a
    // human confirmation in the adapter; the pending entry is closed either way.
    this.pendingDirectoryDeletes.delete(key)
    return {
      ...decision,
      source: 'directory-delete',
      category: 'directory-delete',
      reason: decision.reason ?? 'Directory deletion requires human confirmation',
    }
  }

  private recordPendingDeny(request: GuardRequest, command: string, risk?: RiskLevel): void {
    this.pendingDenies.set(buildSessionKey(request.session, request.workspace, command), risk)
  }

  private pendingDenyDecision(request: GuardRequest, command: string): Decision | undefined {
    const sessionKey = buildSessionKey(request.session, request.workspace, command)
    if (this.sessionCache.get(sessionKey)) return undefined
    if (!this.pendingDenies.has(sessionKey)) return undefined
    const risk = this.pendingDenies.get(sessionKey)
    return {
      kind: 'ask',
      source: 'llm',
      ...(risk !== undefined ? { risk } : {}),
      reason: coreMessage(this.lang, 'pendingDenyAskReason'),
      command,
    }
  }

  /** Check pending deny for a segment, including leaves inside a pipeline segment. */
  private pendingDenyForParts(request: GuardRequest, command: string): Decision | undefined {
    const whole = this.pendingDenyDecision(request, command)
    if (whole) return whole
    const leaves = splitShellCommand(command, true)
    if (leaves.length > 1) {
      for (const leaf of leaves) {
        const pending = this.pendingDenyDecision(request, leaf)
        if (pending) return pending
      }
    }
    return undefined
  }

  private isRemoveItem(command: string): boolean {
    return /\bremove-item\b/i.test(command)
  }

  private async removeItemTargetType(request: GuardRequest, command: string): Promise<'directory' | 'file' | 'unknown'> {
    const target = this.extractRemoveItemPath(command)
    if (!target) return 'unknown'
    const absolute = resolve(request.workspace ?? process.cwd(), target)
    try {
      const info = await stat(absolute)
      return info.isDirectory() ? 'directory' : 'file'
    } catch {
      return 'unknown'
    }
  }

  private extractRemoveItemPath(command: string): string | undefined {
    const match = /\bremove-item\b/i.exec(command)
    if (!match) return undefined
    const rest = command.slice(match.index + match[0].length).trim()
    const stripQuotes = (value: string): string => value.replace(/^["']|["']$/g, '')
    const quotedPath = /(?:^|\s)(?:-path|-literalpath)\s+("(?:[^"]*)"|'(?:[^']*)')/i.exec(rest)
    if (quotedPath) return stripQuotes(quotedPath[1])
    const unquotedPath = /(?:^|\s)(?:-path|-literalpath)\s+([^\s;"'|&]+)/i.exec(rest)
    if (unquotedPath) return unquotedPath[1]
    const tokens = rest.match(/("(?:[^"]*)"|'(?:[^']*)'|[^\s;"'|&]+)/g) ?? []
    for (const token of tokens) {
      const value = stripQuotes(token)
      if (value && !value.startsWith('-')) return value
    }
    return undefined
  }

  private extractDeletionReason(request: GuardRequest, afterTime: number): string | undefined {
    // Preferred: reason supplied by the interactive UI (or headless marker).
    if (request.deletionReason && request.deletionReason.trim()) {
      return request.deletionReason.trim().slice(0, 2800)
    }
    // Fallback: scan the command itself for a [删除理由] marker.
    const commandReason = extractMarkerReason(request.command)
    if (commandReason) return commandReason
    // Last resort: scan session events for an assistant message with the marker.
    const events = request.events
    if (!Array.isArray(events)) return undefined
    for (const event of events) {
      if (typeof event !== 'object' || event === null) continue
      const candidate = event as { type?: unknown; time?: unknown; data?: unknown }
      if (candidate.type !== 'assistant/message') continue
      if (typeof candidate.time !== 'number' || candidate.time <= afterTime) continue
      const text = this.messageText(candidate.data)
      const markerIndex = text.indexOf('[删除理由]')
      if (markerIndex >= 0) {
        const reason = text.slice(markerIndex + '[删除理由]'.length).trim()
        if (reason) return reason.slice(0, 2800)
      }
    }
    return undefined
  }

  private messageText(data: unknown): string {
    if (typeof data !== 'object' || data === null) return ''
    const message = (data as { message?: unknown }).message
    if (typeof message !== 'object' || message === null) return ''
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((block) => {
        if (typeof block !== 'object' || block === null) return ''
        const textBlock = block as { type?: unknown; text?: unknown }
        return textBlock.type === 'text' && typeof textBlock.text === 'string' ? textBlock.text : ''
      })
      .join('')
  }

  private templateCacheDecision(command: string): Decision | undefined {
    if (!this.templateCache) return undefined
    const classification = classifyCommand(command, this.rules)
    if (classification.category !== 'unknown') return undefined
    if (hasCommandSubstitution(command) || /[<>]/.test(command)) return undefined
    if (splitShellCommand(command).some((segment) => isHighRiskStateChangingCommand(segment))) return undefined
    if (containsDangerousPattern(command, this.rules)) return undefined
    const entry = this.templateCache.get(command)
    if (!entry || entry.decision !== 'allow') return undefined
    return {
      kind: 'allow',
      source: 'learned',
      risk: entry.risk,
      reason: entry.reason ?? 'Template cache hit',
      cached: true,
      category: 'cacheable',
    }
  }

  private rememberTemplateCache(command: string, decision: Decision): void {
    if (!this.templateCache || decision.kind !== 'allow' || decision.risk === 'high') return
    const entry = entryForDecision(
      { kind: 'allow', risk: decision.risk, reason: decision.reason },
      ttlForRisk(decision.risk, this.config.lowRiskTtlDays, this.config.mediumRiskTtlDays),
    )
    this.templateCache.set(command, entry)
  }

  private historyDecision(request: GuardRequest, command: string): Decision | undefined {
    if (!this.config.historyEnabled || !this.config.examineEnabled || !this.historyStore) return undefined
    if (hasCommandSubstitution(command) || /[<>]/.test(command)) return undefined
    const classification = classifyCommand(command, this.rules)
    if (
      classification.category === 'always-review' ||
      classification.category === 'hard-deny' ||
      classification.category === 'directory-delete'
    ) {
      return undefined
    }
    if (splitShellCommand(command).some((segment) => isHighRiskStateChangingCommand(segment))) return undefined
    const decision = this.historyStore.decide(command, this.config.historyMinTotal, this.config.historyMinLlm)
    if (!decision) return undefined
    this.writeSessionCache(request, command, { kind: 'allow', risk: decision.risk, reason: decision.reason })
    return decision
  }

  private cacheHit(request: GuardRequest, command: string): Decision | undefined {
    const sessionKey = buildSessionKey(request.session, request.workspace, command)
    const sessionEntry = this.sessionCache.get(sessionKey)
    if (sessionEntry) {
      this.stats.sessionCacheHits++
      return this.fromCache(sessionEntry, 'session-cache')
    }

    // A pending deny asks before an older persistent allow can mask it.
    const pending = this.pendingDenyDecision(request, command)
    if (pending) return pending

    const workspaceKey = buildWorkspaceKey(request.workspace, command)
    const persistentEntry = this.persistentCache.get(workspaceKey)
    if (persistentEntry) {
      this.stats.persistentCacheHits++
      this.sessionCache.set(sessionKey, persistentEntry)
      return this.fromCache(persistentEntry, 'persistent-cache')
    }
    return undefined
  }

  private fromCache(entry: CacheEntry, source: 'session-cache' | 'persistent-cache'): Decision {
    return {
      kind: entry.decision,
      risk: entry.risk,
      reason: entry.reason,
      source,
      cached: true,
      category: 'cacheable',
    }
  }

  private writeSessionCache(request: GuardRequest, command: string, decision: AllowDenyDecision, ttlMs?: number): void {
    const ttl = ttlMs ?? ttlForRisk(decision.risk, this.config.lowRiskTtlDays, this.config.mediumRiskTtlDays)
    const entry = entryForDecision(decision, ttl)
    this.sessionCache.set(buildSessionKey(request.session, request.workspace, command), entry)
  }

  private writePersistentCache(
    request: GuardRequest,
    command: string,
    decision: { kind: 'allow'; risk?: RiskLevel; reason?: string },
  ): void {
    const ttl = ttlForRisk(decision.risk, this.config.lowRiskTtlDays, this.config.mediumRiskTtlDays)
    const entry = entryForDecision(decision, ttl)
    this.persistentCache.set(buildWorkspaceKey(request.workspace, command), entry)
    this.persistentCache.save()
  }

  private fileTrackerDefault(scriptPath: string): Decision {
    if (this.config.fileTrackerDefault === 'deny') {
      return { kind: 'deny', source: 'file-tracker', reason: `Write-then-execute detected on sensitive script ${scriptPath}; denied by config` }
    }
    return { kind: 'ask', source: 'file-tracker', reason: `Write-then-execute detected on sensitive script ${scriptPath}; please confirm` }
  }

  private async llmDecision(
    request: GuardRequest,
    ctx: { command: string; script?: string; deletionReason?: string; reasoningEffort?: string },
    source: 'llm' | 'file-tracker',
    guardMemory = true,
  ): Promise<Decision> {
    if (guardMemory && source === 'llm') {
      const pending = this.pendingDenyDecision(request, ctx.command)
      if (pending) return pending
    }
    this.stats.llmCalls++
    try {
      const result = await this.llmReviewer.review({
        command: ctx.command,
        workspace: request.workspace,
        script: ctx.script,
        deletionReason: ctx.deletionReason,
        reasoningEffort: ctx.reasoningEffort,
        signal: request.signal,
      })
      const decision = { ...this.fromLlm(result, source), command: ctx.command }
      if (source === 'llm') this.rememberTemplateCache(ctx.command, decision)
      return decision
    } catch (e) {
      return { ...this.failClosed(source, e instanceof Error ? e.message : String(e)), command: ctx.command }
    }
  }

  private fromLlm(result: LlmReviewResult, source: 'llm' | 'file-tracker'): Decision {
    const reason = result.reason || 'Reviewed by LLM'
    if (result.decision === 'allow') return { kind: 'allow', risk: result.risk, reason, source }
    if (result.decision === 'deny') return { kind: 'deny', risk: result.risk, reason, source }
    return { kind: 'ask', risk: result.risk, reason, source }
  }

  private failClosed(source: 'llm' | 'file-tracker', error?: string): Decision {
    const detail = error ? ` (${error.slice(0, 200)})` : ''
    if (this.config.onTimeout === 'deny') {
      return { kind: 'deny', source, reviewerFailed: true, reason: `Reviewer failed${detail}; denied by fail-closed policy` }
    }
    return { kind: 'ask', source, reviewerFailed: true, reason: `Reviewer failed${detail}; asking for confirmation` }
  }
}

/** Extract a `[删除理由] <reason>` marker from a command line (headless retry).
 *  Returns the reason and the command with the marker stripped. */
export function extractDeletionMarker(command?: string): { reason: string; cleaned: string } | undefined {
  if (!command) return undefined
  const idx = command.indexOf('[删除理由]')
  if (idx < 0) return undefined
  const reason = command.slice(idx + '[删除理由]'.length).trim()
  if (!reason) return undefined
  const cleaned = command.slice(0, idx).trim()
  return { reason: reason.slice(0, 2800), cleaned }
}

/** Extract just the `[删除理由]` reason text from a command line, if present. */
export function extractMarkerReason(command?: string): string | undefined {
  return extractDeletionMarker(command)?.reason
}

/**
 * Prepare a headless directory-delete retry: strip the `[删除理由]` marker from
 * the command and supply it as the explicit deletion reason, so the marker is
 * never left in the command that actually executes.
 */
export function prepareDeletionMarker(request: GuardRequest): { request: GuardRequest; cleanedCommand?: string } {
  const marker = extractDeletionMarker(request.command)
  if (!marker) return { request }
  return {
    request: { ...request, command: marker.cleaned, deletionReason: marker.reason },
    cleanedCommand: marker.cleaned || undefined,
  }
}
