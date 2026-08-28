/**
 * Host-agnostic management operations (ADR-0009 core half).
 *
 * These functions implement the semantics behind the `guard` / `set` /
 * `examine` / `optimize` command groups. They take plain data and injected
 * stores, never touch a host SDK or the terminal; the unified CLI renders
 * their results, pi slash commands and the dsh settings UI call them directly.
 * All user-facing strings are product text and intentionally live here so the
 * three surfaces stay word-for-word identical.
 */
import { loadAnalyzeState, updateLastAnalysis } from './analyze-state.ts'
import { formatLocalTime, truncateOneLine, type RuntimeStatus } from './decision-history.ts'
import { generateLearnedRules, loadLearnedRules, restoreLearnedRules, writeLearnedRules, type LearnedRulesFile } from './learned-rules.ts'
import { sourceTag } from './notify.ts'
import type { AuditStore } from './audit.ts'
import type { GuardConfig, RulesFile } from './types.ts'

/** Enable or disable the guard; returns the user-facing confirmation. */
export function setEnabled(config: GuardConfig, enabled: boolean): string {
  config.enabled = enabled
  return enabled ? '🛡️ auto-guard:on — 守卫已启用' : 'auto-guard:off — 守卫已停用，所有工具调用直接放行'
}

/** `guard status` lines. `configPath` is display-only. */
export function statusLines(config: GuardConfig, status: RuntimeStatus, configPath: string, auditCount?: number): string[] {
  const hasKey = Boolean(config.apiKey)
  const lines = [
    `enabled : ${config.enabled}`,
    `config  : ${configPath}`,
    `review  : ${config.apiBase} · ${config.model}${hasKey ? '' : ' · ⚠ 无 API Key（fail-closed）'}`,
    `examine : ${config.examineEnabled ? 'on' : 'off'} · history: ${config.historyEnabled ? 'on' : 'off'}`,
  ]
  if (auditCount !== undefined) lines.push(`审计库记录总数：${auditCount}`)
  if (status.lastRunAt) {
    lines.push(
      `last    : ${status.lastTool ?? '?'} → ${status.lastDecisionKind ?? '?'}${status.lastDecisionSource ? ` [${status.lastDecisionSource}]` : ''} @ ${formatLocalTime(status.lastRunAt)}${status.lastCommand ? ` · ${truncateOneLine(status.lastCommand, 60)}` : ''}`,
    )
    if (status.reviewerLastFailed) lines.push('⚠ 最近一次 LLM 审查失败')
  }
  return lines
}

/** `guard recent` lines: what hit, which layer, pull-based notification. */
export function recentLines(entries: readonly RuntimeStatus[], count = 10): string[] {
  if (entries.length === 0) return ['(暂无裁决历史)']
  const lines = ['时间            工具    结果    层级       命令/路径']
  for (const entry of entries.slice(-count)) {
    const time = formatLocalTime(entry.lastRunAt)
    const tool = (entry.lastTool ?? '?').padEnd(11)
    const kind = (entry.lastDecisionKind ?? '?').padEnd(7)
    const layer = sourceTag(entry.lastDecisionSource as never).padEnd(6)
    const subject = entry.lastCommand ?? entry.lastDetail ?? ''
    lines.push(`${time}  ${tool} ${kind} ${layer}  ${truncateOneLine(subject, 48)}`)
  }
  return lines
}

/** Mask a key for display: keep head and tail, never the middle. */
export function maskKey(key: string): string {
  return key.length <= 8 ? '***' : `${key.slice(0, 4)}***${key.slice(-4)}`
}

/** Apply `set set-api base|model|reset`; mutates `config` when valid. */
export function applySetApi(config: GuardConfig, sub: string | undefined, value: string | undefined, defaults: GuardConfig): { ok: boolean; message: string } {
  if (sub === 'reset') {
    config.apiBase = defaults.apiBase
    config.model = defaults.model
    config.fallbackModel = defaults.fallbackModel
    return { ok: true, message: `已恢复默认审查端点（${defaults.apiBase} · ${defaults.model}）` }
  }
  if ((sub === 'base' || sub === 'model') && value !== undefined) {
    if (sub === 'base') config.apiBase = value
    else config.model = value
    return { ok: true, message: `已更新审查端点 ${sub}=${value}` }
  }
  return { ok: false, message: '用法：set set-api base <url> | set set-api model <id> | set set-api reset；API Key 走环境变量或加密存储，拒绝命令行传 Key' }
}

/** Apply `set history on|off`; warns when the audit source is off. */
export function applyHistoryToggle(config: GuardConfig, toggle: string | undefined): { ok: boolean; messages: string[] } {
  if (toggle !== 'on' && toggle !== 'off') {
    return { ok: false, messages: ['用法：set history <on|off>'] }
  }
  config.historyEnabled = toggle === 'on'
  const messages = [`history 层已${toggle === 'on' ? '开启' : '关闭'}（按命令骨架复用 60 天审计放行记录）`]
  if (toggle === 'on' && !config.examineEnabled) {
    messages.push('⚠ examine 未开启：history 层依赖审计数据，请先 examine on 积累记录')
  }
  return { ok: true, messages }
}

/** `examine status` lines. */
export function examineStatusLines(config: GuardConfig): string[] {
  return [`examineEnabled: ${config.examineEnabled}`, `db: ${config.auditDbPath}`]
}

/** `optimize status` lines. */
export function optimizeStatusLines(config: GuardConfig, learned: LearnedRulesFile, lastAnalysisAt?: string): string[] {
  const interval = config.analyzeIntervalMinutes > 0 ? `${config.analyzeIntervalMinutes} 分钟` : `${config.analyzeIntervalDays} 天`
  return [
    `autoAnalyzeEnabled: ${config.autoAnalyzeEnabled}`,
    `lastAnalysisAt    : ${lastAnalysisAt ? formatLocalTime(lastAnalysisAt) : '从未'}`,
    `interval          : ${interval}`,
    `rowLimit          : ${config.analyzeRowLimit}（每次分析最近 N 条审计）`,
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
export function analyzeLearnedRules(deps: AnalyzeDeps): { ok: boolean; message: string } {
  const { config } = deps
  if (!config.examineEnabled) {
    return { ok: false, message: '请先开启审查日志（examine on）再分析' }
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
    message: `学习规则分析完成（最近 ${window.length}/${rows.length} 条）：cacheable ${rules.cacheable.length} 条已写入 learned-rules.json`,
  }
}

/** `optimize list` lines. */
export function optimizeListLines(learned: LearnedRulesFile): string[] {
  if (learned.cacheable.length === 0) return ['(无学习规则)']
  return learned.cacheable.map((rule) => `${rule.pattern}${rule.reason ? ` — ${rule.reason}` : ''}`)
}

/** `optimize rollback`: restore learned rules from the backup copy. */
export function rollbackLearnedRules(config: GuardConfig): { ok: boolean; message: string } {
  const ok = restoreLearnedRules(config.learnedRulesPath, config.learnedBackupPath)
  return { ok, message: ok ? '已从备份恢复学习规则' : '没有可用的备份文件' }
}

/** Convenience for callers that want status + list in one shot. */
export function optimizeSnapshot(config: GuardConfig): { status: string[]; list: string[] } {
  const state = loadAnalyzeState(config.analyzeStatePath)
  const learned = loadLearnedRules(config.learnedRulesPath)
  return { status: optimizeStatusLines(config, learned, state.lastAnalysisAt), list: optimizeListLines(learned) }
}
