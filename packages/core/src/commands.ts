/**
 * Host-agnostic management operations (ADR-0009 core half).
 *
 * These functions implement the semantics behind the `guard` / `set` /
 * `examine` / `optimize` command groups. They take plain data and injected
 * stores, never touch a host SDK or the terminal; the unified CLI renders
 * their results, pi slash commands and the dsh settings UI call them directly.
 * All user-facing strings are product text and intentionally live here so the
 * three surfaces stay word-for-word identical. Strings resolve through the
 * core catalog; the trailing `lang` parameter defaults to the config's own
 * language so existing zh callers keep their byte-stable output (ADR-0011).
 */
import { loadAnalyzeState, updateLastAnalysis } from './analyze-state.ts'
import type { AuditStore, AuditWindowSummary } from './audit.ts'
import { formatLocalTime, truncateOneLine, type RuntimeStatus } from './decision-history.ts'
import { generateLearnedRules, loadLearnedRules, restoreLearnedRules, writeLearnedRules, type LearnedRulesFile } from './learned-rules.ts'
import { coreMessage } from './messages.ts'
import { sourceTag } from './notify.ts'
import { langOf, normalizeLang, type Lang } from './lang.ts'
import type { GuardConfig, RulesFile } from './types.ts'

/** Enable or disable the guard; returns the user-facing confirmation. */
export function setEnabled(config: GuardConfig, enabled: boolean, lang: Lang = langOf(config)): string {
  config.enabled = enabled
  return enabled ? coreMessage(lang, 'setEnabledOn') : coreMessage(lang, 'setEnabledOff')
}

/** `guard status` lines. `configPath` is display-only. */
export function statusLines(config: GuardConfig, status: RuntimeStatus, configPath: string, auditCount?: number, lang: Lang = langOf(config)): string[] {
  const hasKey = Boolean(config.apiKey)
  const lines = [
    `enabled : ${config.enabled}`,
    `lang    : ${lang}`,
    `config  : ${configPath}`,
    `review  : ${config.apiBase} · ${config.model}${hasKey ? '' : coreMessage(lang, 'statusNoKey')}`,
    `examine : ${config.examineEnabled ? 'on' : 'off'} · history: ${config.historyEnabled ? 'on' : 'off'}`,
  ]
  if (auditCount !== undefined) lines.push(coreMessage(lang, 'statusAuditCount', { count: auditCount }))
  if (status.lastRunAt) {
    lines.push(
      `last    : ${status.lastTool ?? '?'} → ${status.lastDecisionKind ?? '?'}${status.lastDecisionSource ? ` [${status.lastDecisionSource}]` : ''} @ ${formatLocalTime(status.lastRunAt)}${status.lastCommand ? ` · ${truncateOneLine(status.lastCommand, 60)}` : ''}`,
    )
    if (status.reviewerLastFailed) lines.push(coreMessage(lang, 'statusReviewerFailed'))
  }
  return lines
}

/** `guard recent` lines: what hit, which layer, pull-based notification. */
export function recentLines(entries: readonly RuntimeStatus[], count = 10, lang: Lang = 'zh'): string[] {
  if (entries.length === 0) return [coreMessage(lang, 'recentEmpty')]
  const lines = [coreMessage(lang, 'recentHeader')]
  for (const entry of entries.slice(-count)) {
    const time = formatLocalTime(entry.lastRunAt)
    const tool = (entry.lastTool ?? '?').padEnd(11)
    const kind = (entry.lastDecisionKind ?? '?').padEnd(7)
    const layer = sourceTag(entry.lastDecisionSource as never, lang).padEnd(6)
    const subject = entry.lastCommand ?? entry.lastDetail ?? ''
    lines.push(`${time}  ${tool} ${kind} ${layer}  ${truncateOneLine(subject, 48)}`)
  }
  return lines
}

/**
 * `guard report [days]` lines: verdict counts over the window by kind and by
 * decision source (LLM vs each rule/cache layer), plus the fail-closed count.
 * Pure rendering over an {@link AuditWindowSummary} — the store does the math.
 */
export function reportLines(summary: AuditWindowSummary, days: number, lang: Lang = 'zh'): string[] {
  if (summary.total === 0) return [coreMessage(lang, 'reportEmpty', { days, dbTotal: summary.dbTotal })]
  const llm = summary.bySource.find((entry) => entry.source === 'llm')?.count ?? 0
  const lines = [
    coreMessage(lang, 'reportHeader', { days, dbTotal: summary.dbTotal }),
    coreMessage(lang, 'reportKinds', { total: summary.total, allow: summary.allow, deny: summary.deny, ask: summary.ask }),
  ]
  if (llm > 0 || summary.reviewerFailed > 0) {
    lines.push(coreMessage(lang, 'reportLlm', { llm, failed: summary.reviewerFailed }))
  }
  lines.push(coreMessage(lang, 'reportBySource'))
  for (const { source, count } of summary.bySource) {
    lines.push(`  ${sourceTag(source as never, lang).padEnd(8)} ${count}`)
  }
  return lines
}

/** Mask a key for display: keep head and tail, never the middle. */
export function maskKey(key: string): string {
  return key.length <= 8 ? '***' : `${key.slice(0, 4)}***${key.slice(-4)}`
}

/**
 * Apply `set lang <zh|en>`; mutates `config.lang` when valid. Receipt and
 * error wording live in each surface's catalog (the receipt must speak the
 * NEW language), so this returns the resolved value, not text.
 */
export function applySetLang(config: GuardConfig, value: string | undefined): { ok: boolean; lang?: Lang } {
  const parsed = normalizeLang(value)
  if (!parsed) return { ok: false }
  config.lang = parsed
  return { ok: true, lang: parsed }
}

/** Apply `set set-api base|model|reset`; mutates `config` when valid. */
export function applySetApi(config: GuardConfig, sub: string | undefined, value: string | undefined, defaults: GuardConfig, lang: Lang = langOf(config)): { ok: boolean; message: string } {
  if (sub === 'reset') {
    config.apiBase = defaults.apiBase
    config.model = defaults.model
    config.fallbackModel = defaults.fallbackModel
    return { ok: true, message: coreMessage(lang, 'setApiResetOk', { base: defaults.apiBase, model: defaults.model }) }
  }
  if ((sub === 'base' || sub === 'model') && value !== undefined) {
    if (sub === 'base') config.apiBase = value
    else config.model = value
    return { ok: true, message: coreMessage(lang, 'setApiUpdateOk', { sub, value }) }
  }
  return { ok: false, message: coreMessage(lang, 'setApiUsage') }
}

/** Apply `set history on|off`; warns when the audit source is off. */
export function applyHistoryToggle(config: GuardConfig, toggle: string | undefined, lang: Lang = langOf(config)): { ok: boolean; messages: string[] } {
  if (toggle !== 'on' && toggle !== 'off') {
    return { ok: false, messages: [coreMessage(lang, 'historyUsage')] }
  }
  config.historyEnabled = toggle === 'on'
  const messages = [coreMessage(lang, toggle === 'on' ? 'historyEnabledNote' : 'historyDisabledNote')]
  if (toggle === 'on' && !config.examineEnabled) {
    messages.push(coreMessage(lang, 'historyNeedsExamine'))
  }
  return { ok: true, messages }
}

/** `examine status` lines. */
export function examineStatusLines(config: GuardConfig): string[] {
  return [`examineEnabled: ${config.examineEnabled}`, `db: ${config.auditDbPath}`]
}

/** `optimize status` lines. */
export function optimizeStatusLines(config: GuardConfig, learned: LearnedRulesFile, lastAnalysisAt?: string, lang: Lang = langOf(config)): string[] {
  const interval = coreMessage(lang, config.analyzeIntervalMinutes > 0 ? 'intervalMinutes' : 'intervalDays', {
    count: config.analyzeIntervalMinutes > 0 ? config.analyzeIntervalMinutes : config.analyzeIntervalDays,
  })
  return [
    `autoAnalyzeEnabled: ${config.autoAnalyzeEnabled}`,
    `lastAnalysisAt    : ${lastAnalysisAt ? formatLocalTime(lastAnalysisAt) : coreMessage(lang, 'never')}`,
    `interval          : ${interval}`,
    coreMessage(lang, 'rowLimitDetail', { limit: config.analyzeRowLimit }),
    `cacheable rules   : ${learned.cacheable.length}`,
  ]
}

/** Dependencies of the analyze operation, all injected. */
export interface AnalyzeDeps {
  config: GuardConfig
  rules: RulesFile
  audit: AuditStore
}

/** `optimize analyze`: run one learned-rule analysis over recent audit rows. */
export function analyzeLearnedRules(deps: AnalyzeDeps, lang: Lang = langOf(deps.config)): { ok: boolean; message: string } {
  const { config } = deps
  if (!config.examineEnabled) {
    return { ok: false, message: coreMessage(lang, 'analyzeNeedsExamine') }
  }
  const rows = deps.audit.list()
  const window = rows.slice(-Math.max(1, config.analyzeRowLimit))
  const rules = generateLearnedRules(window, {
    days: config.historyDays,
    cacheableMinTotal: config.learnedCacheableMinTotal,
    cacheableMinLlm: 1,
    sensitivePaths: deps.rules.sensitivePaths,
    excludedRules: [...deps.rules.hardDeny, ...deps.rules.alwaysReview, ...deps.rules.directoryDelete],
  })
  writeLearnedRules(config.learnedRulesPath, config.learnedBackupPath, rules)
  updateLastAnalysis(config.analyzeStatePath)
  return {
    ok: true,
    message: coreMessage(lang, 'analyzeDone', { analyzed: window.length, total: rows.length, count: rules.cacheable.length }),
  }
}

/** `optimize list` lines: one line per rule, its learning reason on the next
 * indented line — pattern and rationale read as a pair instead of one long
 * wrapped row (user feedback). */
export function optimizeListLines(learned: LearnedRulesFile, lang: Lang = 'zh'): string[] {
  if (learned.cacheable.length === 0) return [coreMessage(lang, 'optimizeListEmpty')]
  return learned.cacheable.flatMap((rule) => (rule.reason ? [rule.pattern, `  ${rule.reason}`] : [rule.pattern]))
}

/** `optimize rollback`: restore learned rules from the backup copy. */
export function rollbackLearnedRules(config: GuardConfig, lang: Lang = langOf(config)): { ok: boolean; message: string } {
  const ok = restoreLearnedRules(config.learnedRulesPath, config.learnedBackupPath)
  return { ok, message: ok ? coreMessage(lang, 'rollbackDone') : coreMessage(lang, 'rollbackNoBackup') }
}

/** Convenience for callers that want status + list in one shot. */
export function optimizeSnapshot(config: GuardConfig, lang: Lang = langOf(config)): { status: string[]; list: string[] } {
  const state = loadAnalyzeState(config.analyzeStatePath)
  const learned = loadLearnedRules(config.learnedRulesPath)
  return { status: optimizeStatusLines(config, learned, state.lastAnalysisAt, lang), list: optimizeListLines(learned, lang) }
}
