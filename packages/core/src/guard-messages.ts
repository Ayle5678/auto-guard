/**
 * Shared guard-surface message catalog (zh / en) — the user-visible wording
 * of the guard surface itself (receipts, usage, the deletion flow, key and
 * audit management), hosted in core beside `defineCatalog` so every host
 * resolves it through one definition (ADR-0023). Host chrome — dialogs,
 * settings pages, installer, TUI — stays in the host packages; host-flavored
 * wording rides `HostDescriptor.catalogOverride` (ADR-0016). Key parity
 * between languages is enforced by the type system. Values are byte-exact
 * migrations of the host wording (SPEC 0021 ticket 02); the usage lines take
 * the driver program name (ADR-0022).
 */
import { defineCatalog, type Lang } from './lang.ts'

const zhGuardSurface = {
    pingOk: 'API 联通成功',
    pingFail: 'API 联通失败：{error}',
    unknownError: '未知错误',
    pingNoDirectEndpoint: '未配置直连审查端点',
    deleteFailReviewerTitle: '审查器故障，这次删除未过审',
    deleteFailLlmTitle: 'LLM 否决了这次删除',
    deleteFailDefaultReason: '审查未通过',
    deleteRunAnyway: '仍要执行吗？',
    deleteAskReason: '🛡️ auto-guard [删除复核] {flavor}：{reason}。是否仍要执行，请在确认框中决定。',
    deleteNoDetail: '未提供详情',
    deletionRetryHint: '如需继续，请在原命令后附带 [删除理由] <你的理由> 重试；理由将由 LLM 复核。',
    askListHeader: '待裁决 ask {count} 条（allow <序号> 本会话放行；deny <序号> --reason <理由> 本会话拒绝）：',
    askListEmpty: '没有待裁决的 ask（宿主确认框触发时才会产生；会话记忆随会话目录 24h 剪枝消失）。',
    askRow: '[{index}] {time}  {command}（{risk} · {workspace}）',
    askResolvedAllow: '✅ 已记入本会话放行：{command}（本会话内完全相同的命令不再询问）',
    askResolvedDeny: '⛔ 已记入本会话拒绝：{command}（未附理由；完全相同的命令本会话内将直接拒绝）',
    askResolvedDenyWithReason: '⛔ 已记入本会话拒绝：{command}\n理由：{reason}（完全相同的命令本会话内将以此理由直接拒绝）',
    askInvalidIndex: '无效序号：{value}（应为正整数；先运行 guard ask list 查看当前序号）',
    askStaleIndex: '序号 {index} 已不存在（列表已变化，请重新运行 guard ask list）',
    setKeyNeedsTty: 'set set-key 需要交互式终端（IDE 内置终端即可）。请不要把 Key 粘贴到对话中——那会进入会话日志。',
    setKeyEnvWarning: '⚠ 环境变量 {name} 已设置且优先于本地存储；继续存储仅作为无环境变量环境的兜底。',
    showKeyEnvSet: 'env {name}: 已设置（优先于本地存储）',
    showKeyEnvUnset: 'env {name}: 未设置',
    showKeyStored: 'stored     : 已存储（AES-GCM 加密于 {dir}/api-key.json）',
    showKeyNoStore: 'stored     : (未存储)',
    showKeyLegacy: 'legacy     : {key}（config.json 明文遗留，建议 set-key 重存）',
    showKeyNoLegacy: 'legacy     : (无)',
    clearKeyDone: '已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）',
    setFallbackKeyNeedsTty: 'set set-fallback-key 需要交互式终端。请不要把 Key 粘贴到对话中——那会进入会话日志。',
    setFallbackKeyPrompt: '备用端点 API Key（输入不回显，Ctrl+C 取消）: ',
    setFallbackKeyInvalid: 'Key 无效（过短或含空白），未存储',
    setFallbackKeySaved: '✅ 备用端点 Key 已存储：{key}（加密落盘 api-key-fallback.json）',
    showFallbackKeyEnvSet: 'fallback env {name}: 已设置（优先于备用槽存储）',
    showFallbackKeyEnvUnset: 'fallback env {name}: 未设置',
    showFallbackKeyStored: 'fallback stored: 已存储（AES-GCM 加密于 {dir}/api-key-fallback.json）',
    showFallbackKeyNoStore: 'fallback stored: (未存储)',
    clearFallbackKeyDone: '已清除备用端点的本地存储 Key（加密文件已删除；环境变量不受影响）',
    setLangInvalid: '无效语言值：{value}（可用：zh、en）',
    setLangDone: '语言已设置：{lang}（已写入当前配置根）',
    reloadNote: '配置与规则在每次 hook 进程启动时自动重读',
    examineOn: '审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）',
    examineOff: '审查日志已关闭',
    examineClearedOld: '已删除 {count} 条 30 天前记录',
    examineClearedAll: '已清空全部审查日志',
    statsAuditCount: '审计库记录总数：{count}（学习分析数据源）',
    statsExamineOff: '审查日志未开启（{program} examine on 后才有持久统计）',
    optimizeAutoUnsupported: '用法：{program} set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled',
    exportUnsupported: '当前审计实现不支持明文导出（Light 降级模式）',
    exportDone: '已导出明文审计库到 {path}',
    exportFailed: '明文导出失败，请确认已设置审计密码',
    createNeedsPassword: '请先设置审计密码',
    createUnsupported: '当前审计实现不支持重建（Light 降级模式）',
    createDone: '已创建新的空审计库；旧加密库已保留为 orphan 文件',
    createFailed: '重建审计库失败',
}

const enGuardSurface: Record<keyof typeof zhGuardSurface, string> = {
    pingOk: 'API reachable',
    pingFail: 'API unreachable: {error}',
    unknownError: 'unknown error',
    pingNoDirectEndpoint: 'No direct review endpoint configured',
    deleteFailReviewerTitle: 'Reviewer failure — this deletion was not approved',
    deleteFailLlmTitle: 'The LLM vetoed this deletion',
    deleteFailDefaultReason: 'Review not passed',
    deleteRunAnyway: 'Run it anyway?',
    deleteAskReason: '🛡️ auto-guard [deletion review] {flavor}: {reason}. Run it anyway? Decide in the confirmation dialog.',
    deleteNoDetail: 'no details provided',
    deletionRetryHint: 'To proceed, retry the original command with a [删除理由] <your reason> marker appended; the LLM will review the reason.',
    askListHeader: '{count} pending ask(s) (allow <index> = allow for this session; deny <index> --reason <text> = deny for this session):',
    askListEmpty: 'No pending asks (they are created whenever the host confirmation dialog fires; session memory vanishes with the session directory after 24h idle).',
    askRow: '[{index}] {time}  {command} ({risk} · {workspace})',
    askResolvedAllow: '✅ Recorded for this session: allow {command} (exactly identical commands will not ask again this session)',
    askResolvedDeny: '⛔ Recorded for this session: deny {command} (no reason given; exactly identical commands will be denied without asking this session)',
    askResolvedDenyWithReason: '⛔ Recorded for this session: deny {command}\nReason: {reason} (exactly identical commands will be denied with that reason this session)',
    askInvalidIndex: 'Invalid index: {value} (expected a positive integer; run guard ask list for the current numbering)',
    askStaleIndex: 'Index {index} no longer exists (the list changed; re-run guard ask list)',
    setKeyNeedsTty: 'set set-key needs an interactive terminal (the IDE built-in terminal works). Never paste the key into a chat — it would land in the session log.',
    setKeyEnvWarning: '⚠ Environment variable {name} is set and takes priority over local storage; storing anyway only serves environments without the variable.',
    showKeyEnvSet: 'env {name}: set (takes priority over local storage)',
    showKeyEnvUnset: 'env {name}: not set',
    showKeyStored: 'stored     : stored (AES-GCM encrypted at {dir}/api-key.json)',
    showKeyNoStore: 'stored     : (not stored)',
    showKeyLegacy: 'legacy     : {key} (plaintext legacy in config.json; re-store via set-key)',
    showKeyNoLegacy: 'legacy     : (none)',
    clearKeyDone: 'Locally stored API key cleared (encrypted file deleted; environment variables unaffected)',
    setFallbackKeyNeedsTty: 'set set-fallback-key needs an interactive terminal. Never paste the key into a chat — it would land in the session log.',
    setFallbackKeyPrompt: 'Backup endpoint API key (input hidden, Ctrl+C to cancel): ',
    setFallbackKeyInvalid: 'Invalid key (too short or contains whitespace); nothing stored',
    setFallbackKeySaved: '✅ Backup endpoint key saved: {key} (encrypted to api-key-fallback.json)',
    showFallbackKeyEnvSet: 'fallback env {name}: set (takes priority over the backup slot)',
    showFallbackKeyEnvUnset: 'fallback env {name}: not set',
    showFallbackKeyStored: 'fallback stored: stored (AES-GCM encrypted at {dir}/api-key-fallback.json)',
    showFallbackKeyNoStore: 'fallback stored: (not stored)',
    clearFallbackKeyDone: 'Locally stored backup endpoint key cleared (encrypted file deleted; environment variables unaffected)',
    setLangInvalid: 'Invalid language value: {value} (available: zh, en)',
    setLangDone: 'Language set: {lang} (written to this config root)',
    reloadNote: 'Config and rules are re-read on every hook process start',
    examineOn: 'Audit log enabled (local SQLite + field-level encryption; data never leaves this machine)',
    examineOff: 'Audit log disabled',
    examineClearedOld: 'Deleted {count} record(s) older than 30 days',
    examineClearedAll: 'Cleared all audit records',
    statsAuditCount: 'audit log records: {count} (learned-analysis data source)',
    statsExamineOff: 'Audit log is off (run {program} examine on for persistent stats)',
    optimizeAutoUnsupported: 'Usage: {program} does not support set auto; edit autoAnalyzeEnabled in config.json manually',
    exportUnsupported: 'The current audit implementation does not support plaintext export (Light fallback mode)',
    exportDone: 'Plaintext audit database exported to {path}',
    exportFailed: 'Plaintext export failed; make sure the audit password is set',
    createNeedsPassword: 'Set the audit password first',
    createUnsupported: 'The current audit implementation does not support rebuilding (Light fallback mode)',
    createDone: 'New empty audit database created; the old encrypted database is kept as an orphan file',
    createFailed: 'Failed to rebuild the audit database',
}

const catalog = defineCatalog(zhGuardSurface, enGuardSurface)

/** One shared guard-surface message key. */
export type GuardMessageKey = keyof typeof zhGuardSurface

/** Look up one shared guard-surface message. */
export function guardMessage(lang: Lang, key: GuardMessageKey, params: Record<string, string | number> = {}): string {
  return catalog.message(lang, key, params)
}

/** All shared guard-surface keys (the anti-drift set for host catalogs). */
export const guardMessageKeys = Object.keys(zhGuardSurface) as GuardMessageKey[]

/**
 * Host-flavored guard-surface wording, as data — the pi/dsh counterpart of
 * the hook-host `HostDescriptor.catalogOverride` slot (ADR-0016). Wording
 * differences ride this channel; keys are never re-defined (ADR-0023).
 */
export type GuardMessageOverrides = { readonly [K in GuardMessageKey]?: Partial<Record<Lang, string>> }

/** Runtime key test: does this string name a shared guard-surface key? */
export function isGuardMessageKey(key: string): key is GuardMessageKey {
  return key in zhGuardSurface
}
