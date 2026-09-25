/**
 * GuardService — the single testable seam for auto-guard.
 *
 * `decide()` runs the layered decision pipeline for one normalized execution;
 * the host adapters' event handlers are thin wrappers over it. All I/O (rules, caches, LLM, file system) is injected so unit tests never
 * touch the network or real home directory.
 */
import {
  buildSessionKey,
  buildWorkspaceKey,
  entryForDecision,
  PersistentCache,
  sessionMemoryEntry,
  ttlForRisk,
  type AllowDenyDecision,
  type CacheEntry,
  type SessionCacheLike,
} from './cache.ts'
import { bypassesDeterministicTrust, expandHome, isHighRiskStateChangingCommand, isLowRiskStateChangingCommand, normalizeCommand, splitShellCommand } from './command.ts'
import { extractDeletionReason, isRemoveItemInvocation, matchPending, removeItemTargetTypeOf, type PendingDirectoryDelete } from './directory-delete.ts'
import { FileTracker } from './file-tracker.ts'
import { PersistableMap, type JsonSink } from './persist-map.ts'
import type { HistoryStore } from './history.ts'
import type { TemplateCache } from './template-cache.ts'
import type { LlmReviewer } from './llm.ts'
import type { RiskLevel, RulesFile } from './types.ts'
import { classifyCommand, containsDangerousPattern, staticAllowGuardHit, type Classification } from './rules.ts'
import { matchesSensitivePath, shellCommandHasSensitivePath } from './sensitive-path.ts'
import { truncateOneLine } from './decision-history.ts'
import type { Lang } from './lang.ts'
import { langOf } from './lang.ts'
import { coreMessage } from './messages.ts'
import type { Decision, DecisionSource, GuardRequest, GuardTuning, LlmReviewResult } from './types.ts'

export interface PendingPersistence {
  /** Sink mirroring first-hit directory-delete denials (hook model survives process restarts). */
  directoryDeletes?: JsonSink
  /** Sink mirroring LLM deny records awaiting a user repeat-confirmation. */
  denies?: JsonSink
}

export interface GuardDeps {
  /** The engine-tuning slice of the host's GuardConfig (ADR-0021), cut at the composition root (tuningOf). */
  config: GuardTuning
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

/** The rule-hit subset of DecisionSource — the single list its keys and counters derive from (ADR-0021). */
const RULE_HIT_SOURCES = ['static-allow', 'user-confirmed', 'hard-deny', 'directory-delete', 'file-tracker', 'sensitive-path'] as const

export type RuleHitSource = (typeof RULE_HIT_SOURCES)[number]

function isRuleHitSource(source: DecisionSource): source is RuleHitSource {
  return (RULE_HIT_SOURCES as readonly string[]).includes(source)
}

/** The deterministic hard-deny denial — one definition shared by guardReason and every decide loop (ADR-0021). */
function hardDenyReason(classification: Classification): string {
  return classification.rule?.reason ?? 'Blocked by absolute blacklist'
}

function hardDeny(classification: Classification): Decision {
  return { kind: 'deny', source: 'hard-deny', category: 'hard-deny', reason: hardDenyReason(classification) }
}

/** Which decide loop a segment evaluation runs in — the loops' genuine divergences (ADR-0021). */
type SegmentScope =
  | { loop: 'single' }
  | { loop: 'pipeline-leaf' }
  | { loop: 'compound-segment'; wholeCommand: string }

/** What one segment evaluation concluded before the caller's merge policy. */
type SegmentVerdict =
  | { how: 'decided'; decision: Decision }
  | { how: 'approved'; decision: Decision; segment: string }
  | { how: 'unresolved' }

export interface GuardStats {
  llmCalls: number
  sessionCacheHits: number
  persistentCacheHits: number
  historyHits: number
  learnedHits: number
  ruleHits: Record<RuleHitSource, number>
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
    ruleHits: Object.fromEntries(RULE_HIT_SOURCES.map((source) => [source, 0])) as GuardStats['ruleHits'],
  }
}

export class GuardService {
  private readonly tuning: GuardTuning
  private readonly rules: RulesFile
  private readonly sessionCache: SessionCacheLike
  private readonly persistentCache: PersistentCache
  private readonly llmReviewer: LlmReviewer
  private readonly fileTracker: FileTracker
  private readonly historyStore?: HistoryStore
  private readonly templateCache?: TemplateCache
  private readonly lang: Lang
  private readonly pendingDirectoryDeletes: PersistableMap<PendingDirectoryDelete>
  private readonly pendingDenies: PersistableMap<RiskLevel | undefined>
  readonly stats: GuardStats = createStats()

  constructor(deps: GuardDeps) {
    this.tuning = deps.config
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
      this.pendingDenies.deleteByPrefix(prefix)
      this.pendingDirectoryDeletes.deleteByPrefix(prefix)
    } else {
      this.sessionCache.clear()
      this.pendingDenies.clear()
      this.pendingDirectoryDeletes.clear()
    }
  }

  /** Reset in-memory stats (called at session start). */
  resetStats(): void {
    this.stats.llmCalls = 0
    this.stats.sessionCacheHits = 0
    this.stats.persistentCacheHits = 0
    this.stats.historyHits = 0
    this.stats.learnedHits = 0
    for (const source of RULE_HIT_SOURCES) this.stats.ruleHits[source] = 0
  }

  /** Write a user-chosen session memory entry (ask four-state), alive until session end. */
  rememberAsk(request: GuardRequest, command: string, decision: { kind: 'allow' | 'deny'; reason?: string }): void {
    this.sessionCache.set(buildSessionKey(request.session, request.workspace, command), sessionMemoryEntry(decision.kind, decision.reason))
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
      return hardDenyReason(classification)
    }
    return undefined
  }

  /**
   * Full decision pipeline. See the class doc for ordering.
   */
  async decide(request: GuardRequest): Promise<Decision> {
    const decision = await this.decideRaw(request)
    this.record(decision)
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

  /**
   * The single stats recording point (ADR-0021): rule/history/learned counters
   * derive from the decision's source. Cache hits are counted where the cache
   * decision is produced (fromCache); LLM calls where the review happens
   * (llmDecision) — a pending-deny ask has source `llm` but consumes no call.
   */
  private record(decision: Decision): void {
    if (decision.source === 'history') this.stats.historyHits++
    else if (decision.source === 'learned') this.stats.learnedHits++
    else if (isRuleHitSource(decision.source)) this.stats.ruleHits[decision.source]++
  }

  private decideFile(request: GuardRequest): Decision {
    // A user-chosen session memory (guard ask resolution / pi four-state)
    // outranks the deterministic sensitive-path ask: the human decided for
    // exactly this path, so their choice is consulted first. (The shell path
    // differs by design — sensitive shell commands are demoted to LLM review
    // before any cache is consulted.) Keyed on the file path, the stable text
    // a repeat call presents again.
    if (typeof request.filePath === 'string') {
      const sessionHit = this.consultMemories(request, request.filePath, { session: true })
      if (sessionHit) return sessionHit
    }
    // One payload can carry several targets (codex apply_patch); every one of
    // them crosses the sensitive gate — a lone first-path check would miss
    // `.env` hiding at position two.
    const candidates = [request.filePath, ...(request.paths ?? [])]
    const sensitive = this.rules.sensitivePaths
    for (const candidate of candidates) {
      const path = expandHome(candidate ?? '')
      if (path && sensitive.some((pattern) => matchesSensitivePath(path, pattern))) {
        return {
          kind: 'ask',
          source: 'sensitive-path',
          reason: `Path is on the sensitive list, confirmation required: ${path}`,
        }
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
      return hardDeny(classification)
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

    if (isRemoveItemInvocation(command)) {
      const targetType = await removeItemTargetTypeOf(request.workspace, command)
      if (targetType === 'directory') {
        return this.decideDirectoryDelete(request, command)
      }
      if (targetType === 'unknown') {
        return this.llmDecision(request, { command }, 'llm')
      }
    }

    const verdict = await this.decideSegment(request, command, { loop: 'single' })
    if (verdict.how !== 'unresolved') return verdict.decision

    // Learned templates, then history, then the LLM with the cache write-back.
    const template = this.templateCacheDecision(command)
    if (template) return template

    const history = this.historyDecision(request, command)
    if (history) return history

    return this.reviewUnit(request, command, classification)
  }

  /**
   * The segment-decision seam (ADR-0021): one evaluation of 「分类 → 记忆 →
   * 缓存 → (LLM 由调用方收尾)」 shared by the single-command, pipeline-leaf and
   * compound-segment loops. Private by design — hosts must never bypass
   * decide(), so this stays an internal seam and is not exported. The scope
   * carries the loops' genuine divergences; everything else about evaluating
   * one segment lives here.
   */
  private async decideSegment(request: GuardRequest, segment: string, scope: SegmentScope): Promise<SegmentVerdict> {
    const classification = classifyCommand(segment, this.rules)
    const bypassesStatic = bypassesDeterministicTrust(segment, { pipes: true })

    if (scope.loop === 'single') {
      // A deterministic static/user-confirmed allow needs a clean command line
      // (no substitution, no operators); a session memory still wins first.
      if (!bypassesStatic && (classification.category === 'static-allow' || classification.category === 'user-confirmed')) {
        const sessionHit = this.consultMemories(request, segment, { session: true })
        if (sessionHit) return { how: 'decided', decision: sessionHit }
        if (staticAllowGuardHit(segment, this.rules)) {
          return { how: 'decided', decision: await this.reviewUnit(request, segment, classification) }
        }
        if (classification.category === 'static-allow') {
          return { how: 'approved', decision: { kind: 'allow', source: 'static-allow', category: 'static-allow', reason: classification.rule?.reason }, segment }
        }
        return { how: 'approved', decision: { kind: 'allow', source: 'user-confirmed', category: 'user-confirmed', reason: classification.rule?.reason }, segment }
      }
      // always-review commands use only the short-lived session cache.
      if (classification.category === 'always-review') {
        const sessionHit = this.consultMemories(request, segment, { session: true })
        if (sessionHit) return { how: 'decided', decision: sessionHit }
      }
      // cacheable and unknown commands may use the dynamic caches.
      if (classification.category === 'cacheable' || classification.category === 'unknown') {
        const cached = this.consultMemories(request, segment, { session: true, pending: true, persistent: true })
        if (cached) return { how: 'decided', decision: cached }
      }
      return { how: 'unresolved' }
    }

    if (scope.loop === 'pipeline-leaf') {
      // Per-leaf session memory is honored for allow/deny choices.
      const sessionHit = this.consultMemories(request, segment, { session: true })
      if (sessionHit) {
        return sessionHit.kind !== 'allow'
          ? { how: 'decided', decision: sessionHit }
          : { how: 'approved', decision: sessionHit, segment }
      }
      const plainSafe =
        (classification.category === 'static-allow' || classification.category === 'user-confirmed') &&
        !bypassesStatic &&
        !containsDangerousPattern(segment, this.rules) &&
        !staticAllowGuardHit(segment, this.rules)
      if (plainSafe) {
        const source = classification.category === 'user-confirmed' ? 'user-confirmed' : 'static-allow'
        return { how: 'approved', decision: { kind: 'allow', source, reason: classification.rule?.reason ?? segment }, segment }
      }
      // Already-approved unknown/cacheable leaves may count as deterministic
      // only when an existing cache entry says allow.
      const cached = this.consultMemories(request, segment, { session: true, pending: true, persistent: true })
      if (cached) {
        return cached.kind !== 'allow'
          ? { how: 'decided', decision: cached }
          : { how: 'approved', decision: cached, segment }
      }
      return { how: 'unresolved' }
    }

    // scope.loop === 'compound-segment'
    if (
      isLowRiskStateChangingCommand(segment) &&
      !bypassesStatic &&
      !containsDangerousPattern(segment, this.rules)
    ) {
      return { how: 'approved', decision: { kind: 'allow', source: 'static-allow', reason: 'directory navigation' }, segment }
    }
    if (classification.category === 'static-allow' && !bypassesStatic) {
      const sessionHit = this.consultMemories(request, segment, { session: true })
      if (sessionHit) {
        return sessionHit.kind !== 'allow'
          ? { how: 'decided', decision: sessionHit }
          : { how: 'approved', decision: sessionHit, segment }
      }
      if (staticAllowGuardHit(segment, this.rules)) {
        return { how: 'decided', decision: await this.llmDecision(request, { command: scope.wholeCommand }, 'llm') }
      }
      return { how: 'approved', decision: { kind: 'allow', source: 'static-allow', reason: classification.rule?.reason ?? segment }, segment }
    }
    if (classification.category === 'user-confirmed' && !bypassesStatic) {
      const sessionHit = this.consultMemories(request, segment, { session: true })
      if (sessionHit) {
        return sessionHit.kind !== 'allow'
          ? { how: 'decided', decision: sessionHit }
          : { how: 'approved', decision: sessionHit, segment }
      }
      if (staticAllowGuardHit(segment, this.rules)) {
        return { how: 'decided', decision: await this.llmDecision(request, { command: scope.wholeCommand }, 'llm') }
      }
      return { how: 'approved', decision: { kind: 'allow', source: 'user-confirmed', reason: classification.rule?.reason ?? segment }, segment }
    }
    // always-review subcommands use only the short-lived session cache.
    if (classification.category === 'always-review') {
      const sessionHit = this.consultMemories(request, segment, { session: true })
      if (sessionHit) {
        return sessionHit.kind !== 'allow'
          ? { how: 'decided', decision: sessionHit }
          : { how: 'approved', decision: sessionHit, segment }
      }
    }
    // cacheable and unknown subcommands may use the dynamic cache.
    if (classification.category === 'cacheable' || classification.category === 'unknown') {
      const cached = this.consultMemories(request, segment, { session: true, pending: true, persistent: true })
      if (cached) {
        return cached.kind !== 'allow'
          ? { how: 'decided', decision: cached }
          : { how: 'approved', decision: cached, segment }
      }
    }
    return { how: 'unresolved' }
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
        return hardDeny(classification)
      }
      if (classification.category === 'directory-delete') {
        return this.decideDirectoryDelete(request, command)
      }
      if (isRemoveItemInvocation(leaf)) {
        const targetType = await removeItemTargetTypeOf(request.workspace, leaf)
        if (targetType === 'directory') {
          return this.decideDirectoryDelete(request, command)
        }
      }
    }

    // A whole-pipeline session memory (from an ask four-state choice) applies
    // before per-leaf analysis.
    const wholeSessionHit = this.consultMemories(request, command, { session: true })
    if (wholeSessionHit) return wholeSessionHit

    // A previously denied leaf turns the whole pipeline into an ask before a
    // whole-pipeline persistent allow can mask it.
    for (const leaf of leaves) {
      const pending = this.consultMemories(request, leaf, { pending: true })
      if (pending) {
        return { ...pending, command }
      }
    }

    // Preserve the existing whole-command cache behavior for pipelines that
    // have already been reviewed and cached as one unit.
    const wholeCached = this.consultMemories(request, command, { session: true, pending: true, persistent: true })
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
      const verdict = await this.decideSegment(request, leaf, { loop: 'pipeline-leaf' })
      if (verdict.how === 'decided') return verdict.decision
      if (verdict.how === 'approved') {
        const contribution = verdict.decision
        if (contribution.source === 'session-cache') sawSessionCache = true
        if (contribution.source === 'persistent-cache') sawPersistentCache = true
        if (contribution.source === 'user-confirmed') sawUserConfirmed = true
        risks.push(contribution.risk)
        reasons.push(contribution.reason ?? leaf)
        continue
      }

      // Any leaf that needs judgment sends the whole pipeline to the LLM.
      return this.reviewUnit(request, command, classifyCommand(command, this.rules))
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
        return hardDeny(classification)
      }
      if (classification.category === 'directory-delete') {
        return this.decideDirectoryDelete(request, command)
      }
      if (isRemoveItemInvocation(segment)) {
        const targetType = await removeItemTargetTypeOf(request.workspace, segment)
        if (targetType === 'directory') {
          return this.decideDirectoryDelete(request, command)
        }
      }
    }

    // A whole-compound session memory (from an ask four-state choice) applies
    // before any whole-compound LLM review path.
    const wholeSessionHit = this.consultMemories(request, command, { session: true })
    if (wholeSessionHit) return wholeSessionHit

    // A previously denied subcommand turns the whole compound into an ask
    // before any whole-compound LLM review, unless session memory already
    // covers that subcommand.
    for (const segment of segments) {
      const pending = this.consultMemories(request, segment, { pending: true, pipelineLeaves: true })
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
            return this.fromCache(sessionEntry, 'session-cache')
          }
          // Allow hits are counted again in the per-segment loop when they actually
          // contribute to the final compound decision.
          continue
        }
        const plainStaticAllow =
          classification.category === 'static-allow' &&
          !bypassesDeterministicTrust(segment, { pipes: true }) &&
          !containsDangerousPattern(segment, this.rules) &&
          !staticAllowGuardHit(segment, this.rules)
        const lowRiskNavigation =
          isLowRiskStateChangingCommand(segment) &&
          !bypassesDeterministicTrust(segment, { pipes: true }) &&
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
      const verdict = await this.decideSegment(request, segment, { loop: 'compound-segment', wholeCommand: command })
      if (verdict.how === 'decided') return verdict.decision
      if (verdict.how === 'approved') {
        const contribution = verdict.decision
        if (contribution.source === 'session-cache') sawSessionCache = true
        if (contribution.source === 'persistent-cache') sawPersistentCache = true
        if (contribution.source === 'user-confirmed') sawUserConfirmed = true
        risks.push(contribution.risk)
        reasons.push(contribution.reason ?? segment)
        continue
      }

      // One unmatched subcommand: a per-segment LLM review with the write-back.
      const decision = await this.reviewUnit(request, segment, classifyCommand(segment, this.rules))
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
    const match = matchPending(this.pendingDirectoryDeletes, request, command, this.rules)
    if (!match) {
      this.pendingDirectoryDeletes.set(buildSessionKey(request.session, request.workspace, command.toLowerCase()), { deniedAt: Date.now(), command })
      return {
        kind: 'deny',
        source: 'directory-delete',
        category: 'directory-delete',
        needsReason: true,
        reason: coreMessage(this.lang, 'deleteNeedsReason', { command: truncateOneLine(command, 120) }),
      }
    }

    const reason = extractDeletionReason(request, match.entry.deniedAt)
    if (!reason) {
      return {
        kind: 'deny',
        source: 'directory-delete',
        category: 'directory-delete',
        needsReason: true,
        reason: coreMessage(this.lang, 'deleteRetryNoReason', { command: truncateOneLine(match.entry.command ?? command, 120) }),
      }
    }

    const decision = await this.review(
      request,
      { command, deletionReason: reason, reasoningEffort: 'low' },
      'llm',
    )

    // Single review per pending delete. Non-allow outcomes are resolved by a
    // human confirmation in the adapter; the pending entry is closed either way.
    this.pendingDirectoryDeletes.delete(match.key)
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

  /**
   * The memory layers for one command shape, in their fixed priority order:
   * session memory (a decision the human made for exactly this command) →
   * pending deny (a recent denial must not be masked by an older persistent
   * allow) → workspace persistent cache. Single owner of that order
   * (ADR-0021); callers name the layers they may consult.
   */
  private consultMemories(
    request: GuardRequest,
    command: string,
    layers: { session?: boolean; pending?: boolean; pipelineLeaves?: boolean; persistent?: boolean },
  ): Decision | undefined {
    if (layers.session) {
      const sessionEntry = this.sessionCache.get(buildSessionKey(request.session, request.workspace, command))
      if (sessionEntry) {
        return this.fromCache(sessionEntry, 'session-cache')
      }
    }
    if (layers.pending) {
      const sessionKey = buildSessionKey(request.session, request.workspace, command)
      if (!this.sessionCache.get(sessionKey) && this.pendingDenies.has(sessionKey)) {
        const risk = this.pendingDenies.get(sessionKey)
        return {
          kind: 'ask',
          source: 'llm',
          ...(risk !== undefined ? { risk } : {}),
          reason: coreMessage(this.lang, 'pendingDenyAskReason'),
          command,
        }
      }
      if (layers.pipelineLeaves) {
        const leaves = splitShellCommand(command, true)
        if (leaves.length > 1) {
          for (const leaf of leaves) {
            const leafPending = this.consultMemories(request, leaf, { pending: true })
            if (leafPending) return leafPending
          }
        }
      }
    }
    if (layers.persistent) {
      const workspaceKey = buildWorkspaceKey(request.workspace, command)
      const persistentEntry = this.persistentCache.get(workspaceKey)
      if (persistentEntry) {
        this.sessionCache.set(buildSessionKey(request.session, request.workspace, command), persistentEntry)
        return this.fromCache(persistentEntry, 'persistent-cache')
      }
    }
    return undefined
  }

  private templateCacheDecision(command: string): Decision | undefined {
    if (!this.templateCache) return undefined
    const classification = classifyCommand(command, this.rules)
    if (classification.category !== 'unknown') return undefined
    if (bypassesDeterministicTrust(command, { pipes: false })) return undefined
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
      ttlForRisk(decision.risk, this.tuning.lowRiskTtlDays, this.tuning.mediumRiskTtlDays),
    )
    this.templateCache.set(command, entry)
  }

  private historyDecision(request: GuardRequest, command: string): Decision | undefined {
    if (!this.tuning.historyEnabled || !this.tuning.examineEnabled || !this.historyStore) return undefined
    if (bypassesDeterministicTrust(command, { pipes: false })) return undefined
    const classification = classifyCommand(command, this.rules)
    if (
      classification.category === 'always-review' ||
      classification.category === 'hard-deny' ||
      classification.category === 'directory-delete'
    ) {
      return undefined
    }
    if (splitShellCommand(command).some((segment) => isHighRiskStateChangingCommand(segment))) return undefined
    const decision = this.historyStore.decide(command, this.tuning.historyMinTotal, this.tuning.historyMinLlm)
    if (!decision) return undefined
    // History hits write no cache: the audit store already serves the repeat
    // LLM-free, and session slots are reserved for LLM-reviewed conclusions
    // (spec 0016 — only record what rules / learned rules / history miss).
    return decision
  }

  /**
   * The single production point of a cache-served decision; cache-hit stats
   * derive from the source here (ADR-0021), so no lookup site counts manually.
   */
  private fromCache(entry: CacheEntry, source: 'session-cache' | 'persistent-cache'): Decision {
    if (source === 'session-cache') this.stats.sessionCacheHits++
    else this.stats.persistentCacheHits++
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
    const ttl = ttlMs ?? ttlForRisk(decision.risk, this.tuning.lowRiskTtlDays, this.tuning.mediumRiskTtlDays)
    const entry = entryForDecision(decision, ttl)
    this.sessionCache.set(buildSessionKey(request.session, request.workspace, command), entry)
  }

  private writePersistentCache(
    request: GuardRequest,
    command: string,
    decision: { kind: 'allow'; risk?: RiskLevel; reason?: string },
  ): void {
    const ttl = ttlForRisk(decision.risk, this.tuning.lowRiskTtlDays, this.tuning.mediumRiskTtlDays)
    const entry = entryForDecision(decision, ttl)
    this.persistentCache.set(buildWorkspaceKey(request.workspace, command), entry)
    this.persistentCache.save()
  }

  private fileTrackerDefault(scriptPath: string): Decision {
    if (this.tuning.fileTrackerDefault === 'deny') {
      return { kind: 'deny', source: 'file-tracker', reason: `Write-then-execute detected on sensitive script ${scriptPath}; denied by config` }
    }
    return { kind: 'ask', source: 'file-tracker', reason: `Write-then-execute detected on sensitive script ${scriptPath}; please confirm` }
  }

  /**
   * The seam's LLM step (ADR-0021): review, then the cache write-back policy.
   * The pending-deny escape hatch is rechecked inside llmDecision, so every
   * llm-source review funnels through it — single command, whole pipeline,
   * one compound segment, sensitive-path demotion. The directory-delete
   * single-review flow calls review directly (no recheck by design).
   */
  private async reviewUnit(request: GuardRequest, command: string, classification: Classification): Promise<Decision> {
    const decision = await this.llmDecision(request, { command }, 'llm')
    this.writeBackCaches(request, command, classification, decision)
    return decision
  }

  /**
   * The cache write-back policy in one definition (ADR-0021): an LLM allow
   * below high risk is written back when its classification earns it —
   * always-review into the session slot only, with the short session TTL;
   * cacheable/unknown into both the session slot (risk TTL) and the
   * persistent cache.
   */
  private writeBackCaches(request: GuardRequest, command: string, classification: Classification, decision: Decision): void {
    if (decision.kind !== 'allow' || decision.risk === 'high') return
    if (classification.category === 'always-review') {
      this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason }, this.tuning.alwaysReviewCacheTtlMinutes * 60 * 1000)
    }
    if (classification.category === 'cacheable' || classification.category === 'unknown') {
      this.writeSessionCache(request, command, { kind: decision.kind, risk: decision.risk, reason: decision.reason })
      this.writePersistentCache(request, command, { kind: 'allow', risk: decision.risk, reason: decision.reason })
    }
  }

  /**
   * An LLM review with the pending-deny escape hatch rechecked first (the
   * guardMemory behavior every llm-source review had before ADR-0021).
   */
  private async llmDecision(
    request: GuardRequest,
    ctx: { command: string; script?: string; deletionReason?: string; reasoningEffort?: string },
    source: 'llm' | 'file-tracker',
  ): Promise<Decision> {
    if (source === 'llm') {
      const pending = this.consultMemories(request, ctx.command, { pending: true })
      if (pending) return pending
    }
    return this.review(request, ctx, source)
  }

  /** The raw reviewer call: llm-call accounting, template remember, fail-closed. No pending-deny recheck. */
  private async review(
    request: GuardRequest,
    ctx: { command: string; script?: string; deletionReason?: string; reasoningEffort?: string },
    source: 'llm' | 'file-tracker',
  ): Promise<Decision> {
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
    if (this.tuning.onTimeout === 'deny') {
      return { kind: 'deny', source, reviewerFailed: true, reason: `Reviewer failed${detail}; denied by fail-closed policy` }
    }
    return { kind: 'ask', source, reviewerFailed: true, reason: `Reviewer failed${detail}; asking for confirmation` }
  }
}
