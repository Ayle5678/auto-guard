/**
 * Core shared types for auto-guard.
 *
 * These types intentionally have no dependency on any host internals so the
 * guard service can be unit-tested standalone (only the host adapters and the
 * DeepSeek-compatible reviewer touch host/network surfaces).
 *
 * GuardConfig is the single superset schema: the 38-key hook-host set as the base
 * plus the DSH-specific provider/reasoning/fallback and masked-display keys.
 * Hosts that do not use a key simply ignore it (ADR-0007 capability model).
 */

export type DecisionKind = 'allow' | 'deny' | 'ask'

/** Where a guard decision notification goes: UI-only, model context, or off. */
export type NotifyRoute = 'page' | 'context' | 'off'

export type RiskLevel = 'low' | 'medium' | 'high'

export type CommandCategory =
  | 'static-allow'
  | 'hard-deny'
  | 'directory-delete'
  | 'user-confirmed'
  | 'cacheable'
  | 'always-review'
  | 'unknown'

export type DecisionSource =
  | 'static-allow'
  | 'hard-deny'
  | 'directory-delete'
  | 'user-confirmed'
  | 'session-cache'
  | 'persistent-cache'
  | 'llm'
  | 'file-tracker'
  | 'sensitive-path'
  | 'history'
  | 'learned'
  | 'passthrough'
  | 'error'

export interface Decision {
  kind: DecisionKind
  /** Present when a risk level applies (cached or LLM-produced). */
  risk?: RiskLevel
  /** Human readable reason shown to the user / model. */
  reason?: string
  source: DecisionSource
  /** True when this decision came from a cache hit. */
  cached?: boolean
  /** The command category responsible for the decision when relevant. */
  category?: CommandCategory
  /** True on the first directory-delete denial, when the agent must supply a `[删除理由]` and retry. */
  needsReason?: boolean
  /** True when the LLM reviewer itself failed (timeout/error) and fail-closed policy produced this decision. */
  reviewerFailed?: boolean
  /** The exact command that produced this decision when it differs from the original request (e.g. a compound subcommand). */
  command?: string
}

export interface PatternRule {
  /** Glob-style pattern (`*` matches any run of characters). Exact when no `*`. */
  pattern: string
  /** Human readable description of why this rule exists. */
  reason?: string
}

export interface StaticAllowGuard {
  /** Glob-style rule pattern that, when matched, is scanned for dangerous flags. */
  when: string
  /** Exact tokens that downgrade a static-allow/user-confirmed hit to LLM review. */
  flags: string[]
  /** Human readable description of why this guard exists. */
  reason?: string
}

/**
 * Recursive-delete invariant guard (ADR-0012): when the anchor matches, a
 * command carrying the flag in ANY spelling is a directory delete. Short flag
 * clusters decompose per letter (`-fr` ⇒ f, r); long flags match whole-word
 * (`--recursive`, `--recursive=x`).
 */
export interface DirectoryDeleteGuard {
  /** Glob-style anchor, e.g. `rm *`; only matching commands are scanned. */
  when: string
  /** Single-letter short flags, e.g. `["r"]` — cluster letters are compared case-insensitively, so one entry covers `-r` and `-R`. */
  shortFlags: string[]
  /** Long flag names without the leading `--`, e.g. `["recursive"]`. */
  longFlags: string[]
  /** Human readable description of why this guard exists. */
  reason?: string
}

export interface RulesFile {
  version: 1
  staticAllow: PatternRule[]
  hardDeny: PatternRule[]
  directoryDelete: PatternRule[]
  directoryDeleteGuards: DirectoryDeleteGuard[]
  userConfirmed: PatternRule[]
  cacheable: PatternRule[]
  alwaysReview: PatternRule[]
  staticAllowGuards: StaticAllowGuard[]
  sensitivePaths: string[]
}

/**
 * A normalized, tool-agnostic execution the guard service can evaluate.
 * The host adapter builds this from its native tool event before deciding.
 */
export interface GuardRequest {
  /** Tool name: `bash`, `pwsh`, `write`, `edit`, or `read`. */
  tool: string
  /** For bash/pwsh, the full command line. */
  command?: string
  /** For write/edit/read, the target path. */
  filePath?: string
  /**
   * Additional target paths of one file tool call (SPEC 0015): a codex
   * apply_patch payload touches many files at once, and every one of them
   * must cross the sensitive-path gate. `filePath` stays the primary path
   * (the history subject); `paths` is the full set including it.
   */
  paths?: readonly string[]
  /** Session identity for session-scoped cache keys. */
  session?: string
  /** Workspace identity for workspace-isolated cache keys. */
  workspace?: string
  /** Content being written for write tool (never sent to LLM; only for tracker detection). */
  content?: string
  /** Optional cancellation signal forwarded to LLM calls. */
  signal?: AbortSignal
  /** Session event log, used only to extract the agent-authored deletion reason. */
  events?: readonly unknown[]
  /** Deletion reason supplied by the interactive UI (or headless marker). */
  deletionReason?: string
}

export interface LlmReviewResult {
  decision: DecisionKind
  risk: RiskLevel
  reason: string
}

/** A reviewable script context produced by the file tracker. */
export interface FileTrackerResult {
  /** Absolute path of the script that was written then executed. */
  scriptPath: string
  /** True when both the write and execute happened inside one command. */
  sameCommand: boolean
  /** Script content when it is safe (non-sensitive, shell text) to send to the LLM. */
  content?: string
  /** True when content was withheld because the path/content looks sensitive. */
  sensitiveContent: boolean
}

export type HeadlessMode = 'deny' | 'allow'

export interface GuardConfig {
  /** Master switch toggled by `/guard on|off` and persisted to config.json; DSH uses the permission preset instead. */
  enabled: boolean
  /**
   * Output language for user-visible text (ADR-0011). Absent means "not set":
   * resolution falls through to the machine default and the zh fallback.
   * `set lang` persists it into this host's config root.
   */
  lang?: 'zh' | 'en'
  /** User override rules file. */
  rulesPath: string
  /** Seeded default rules file (first run copies the shipped defaults here). */
  defaultRulesPath: string
  /** Cross-session persistent cache file. */
  cachePath: string
  /** OpenAI-compatible chat completions base URL. Empty means use the host provider route (DSH). */
  apiBase: string
  /** Environment variable holding the review API key. */
  apiKeyEnv: string
  /** Locally stored review API key (legacy plaintext; encrypted key-store wins over this). Empty when unset; the env var wins. */
  apiKey: string
  /** Non-secret masked display value generated server-side from `apiKey`; never used as auth input. DSH settings only. */
  apiKeyMasked?: string
  /** DSH provider route name. Other hosts leave it unused. */
  provider?: string
  /** DSH reasoning effort for the review call. */
  reasoningEffort?: string
  /** Primary review model. */
  model: string
  /** Fallback review model when the primary call fails. */
  fallbackModel: string
  /** DSH fallback provider route. Other hosts leave it unused. */
  fallbackProvider?: string
  /** Per-request timeout in ms (fail-closed on timeout). */
  timeoutMs: number
  /** TTL for low-risk cache entries, in days. */
  lowRiskTtlDays: number
  /** TTL for medium-risk cache entries, in days. */
  mediumRiskTtlDays: number
  /** Fail-closed policy when the reviewer errors or times out. */
  onTimeout: 'deny' | 'ask'
  /** Default decision for the `ask` path when no UI is present. Used by the pi/dsh capability layers; hook hosts delegate to the host permission system. */
  headlessMode: HeadlessMode
  /** Show a notification on cache hits. */
  notifyCacheHit: boolean
  /** Show a notification for LLM / file-tracker / directory-delete decisions. */
  notifyLlmDecision: boolean
  /** Route for allow notifications ('page' by default; rule-based allows never enter context). */
  notifyAllow: NotifyRoute
  /** Route for deny notifications. */
  notifyDeny: NotifyRoute
  /** Route for ask notifications. */
  notifyAsk: NotifyRoute
  /** Default decision when the file tracker fires and can't review safely. */
  fileTrackerDefault: 'ask' | 'deny'
  /** Seconds after which a tracked write is considered stale. */
  fileTrackerWindowSec: number
  /** Max entries in the session LRU cache. */
  sessionCacheSize: number
  /** TTL in minutes for always-review commands allowed by the LLM in the current session. */
  alwaysReviewCacheTtlMinutes: number
  /** Experimental audit log switch; default off. */
  examineEnabled: boolean
  /** Local SQLite database path for the audit log. */
  auditDbPath: string
  /** Audit password used to derive the field-encryption key; secret-role in DSH settings. Legacy plaintext field; encrypted secret store wins. */
  auditPassword?: string
  /** Non-secret masked display value generated server-side from `auditPassword`. DSH settings only. */
  auditPasswordMasked?: string
  /** Internal marker: legacy config has been imported into DSH settings once. */
  configMigrated?: boolean
  /** Runtime history layer switch; default off. */
  historyEnabled: boolean
  /** Automatic learned-rule analysis switch; default off. */
  autoAnalyzeEnabled: boolean
  /** History window in days. */
  historyDays: number
  /** Minimum total allow records for a history hit. */
  historyMinTotal: number
  /** Minimum real LLM allow records for a history hit. */
  historyMinLlm: number
  /** Minimum total allow records for a learned cacheable rule. */
  learnedCacheableMinTotal: number
  /** Automatic analysis interval in minutes; when > 0 it overrides analyzeIntervalDays. */
  analyzeIntervalMinutes: number
  /** Automatic analysis interval in days (fallback when analyzeIntervalMinutes is 0). */
  analyzeIntervalDays: number
  /** Maximum number of most-recent audit rows one analysis reads. */
  analyzeRowLimit: number
  /** Disk-backed learned template cache path. */
  templateCachePath: string
  /** Learned rules file path. */
  learnedRulesPath: string
  /** Backup path used before overwriting learned rules. */
  learnedBackupPath: string
  /** State file path for the last analysis timestamp. */
  analyzeStatePath: string
}
