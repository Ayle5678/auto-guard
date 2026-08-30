/**
 * Shared hook-host message catalog (zh / en) — the runtime's base wording,
 * carried over byte-for-byte from the zcode catalog when the runtime was
 * extracted (ADR-0016, language layer based on the most complete host per
 * ADR-0009). Engine wording comes from the core catalog; the `[删除理由]`
 * marker is protocol, never localized. Key parity between languages is
 * enforced by the type system.
 *
 * `failBootstrap` takes a `{configPath}` placeholder so every host renders
 * its own root; host-flavored wording beyond that rides
 * `HostDescriptor.catalogOverride`.
 */
import { defineCatalog, interpolate, type Lang } from '@auto-guard/core'
import type { HostDescriptor } from './descriptor.ts'

const catalog = defineCatalog(
  {
    usage: '用法：node dist/cli.js <guard|set|examine|optimize> <action>',
    guardUsage: '用法：node dist/cli.js guard <on|off|status|recent|stats|report|ping>',
    setUsage: '用法：node dist/cli.js set <set-key|show-key|clear-key|set-api|lang|history|reload>',
    examineUsage: '用法：node dist/cli.js examine <on|off|status|clear-old|clear-all>',
    optimizeUsage: '用法：node dist/cli.js optimize <status|analyze|list|rollback>',
    statsAuditCount: '审计库记录总数：{count}（学习分析数据源）',
    statsExamineOff: '审查日志未开启（cli.js examine on 后才有持久统计）',
    pingOk: 'API 联通成功',
    pingFail: 'API 联通失败：{error}',
    unknownError: '未知错误',
    showKeyEnvSet: 'env {name}: 已设置（优先于本地存储）',
    showKeyEnvUnset: 'env {name}: 未设置',
    showKeyStored: 'stored     : 已存储（AES-GCM 加密于 {dir}/api-key.json）',
    showKeyNoStore: 'stored     : (未存储)',
    showKeyLegacy: 'legacy     : {key}（config.json 明文遗留，建议 set-key 重存）',
    showKeyNoLegacy: 'legacy     : (无)',
    clearKeyDone: '已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）',
    reloadNote: '配置与规则在每次 hook 进程启动时自动重读',
    setLangInvalid: '无效语言值：{value}（可用：zh、en）',
    setLangDone: '语言已设置：{lang}（已写入当前配置根）',
    optimizeAutoUnsupported: '用法：node dist/cli.js set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled',
    examineOn: '审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）',
    examineOff: '审查日志已关闭',
    examineClearedOld: '已删除 {count} 条 30 天前记录',
    examineClearedAll: '已清空全部审查日志',
    setKeyNeedsTty: 'set set-key 需要交互式终端（IDE 内置终端即可）。请不要把 Key 粘贴到对话中——那会进入会话日志。',
    setKeyEnvWarning: '⚠ 环境变量 {name} 已设置且优先于本地存储；继续存储仅作为无环境变量环境的兜底。',
    wizardBanner: '—— auto-guard 审查端点配置向导（任意一步直接回车 = 保持当前值）——',
    wizardBasePrompt: '[1/3] 审查端点 base URL（回车 = {base}）: ',
    wizardModelPrompt: '[2/3] 模型名称（回车 = {model}）: ',
    wizardKeyPrompt: '[3/3] API Key（输入不回显，Ctrl+C 取消）: ',
    wizardInvalidBase: 'base URL 无效（需要 http(s):// 开头）：{value}，未保存',
    wizardCancelled: '已取消',
    wizardInvalidKey: 'Key 无效（过短或含空白），未存储',
    wizardSaved: '✅ 已保存：端点 {base} · 模型 {model} · Key {key}（加密落盘 api-key.json）',
    wizardSavedHint: '立即生效（新 hook 进程自动读取）；可运行 guard ping 验证连通性',
    deleteFailReviewerTitle: '审查器故障，本次未过审',
    deleteFailLlmTitle: 'LLM 未通过本次删除',
    deleteAskReason: '🛡️ auto-guard [删除复核] {flavor}：{reason}。是否仍要执行，请在确认框中决定。',
    deleteNoDetail: '未提供详情',
    unknownDecisionDenied: '未知裁决，已拦截',
    failStdinNotJson: 'auto-guard：无法解析 hook 输入（stdin 不是合法 JSON），保守起见需要人工确认',
    failBootstrap: 'auto-guard 初始化失败（检查 {configPath}）：{error}；保守起见需要人工确认',
    failDecide: 'auto-guard 裁决过程异常：{error}；保守起见需要人工确认',
    failUncaught: 'auto-guard 未捕获异常：{error}；保守起见需要人工确认',
    passthroughDetail: '直通/放行',
    deletionRetryHint: '如需继续，请在原命令后附带 [删除理由] <你的理由> 重试；理由将由 LLM 复核。',
    hitRule: '规则 {pattern}：{reason}',
    hitRuleDefault: '命中',
    hitSessionCache: '会话缓存复用：{reason}',
    hitCacheDefault: '此前已放行',
    hitPersistentCache: '持久缓存复用：{reason}',
    hitHistory: '历史审计放行：{reason}',
    hitHistoryDefault: '相似命令历史 allow',
    hitLearned: '学习规则放行：{reason}',
    hitLearnedDefault: '模板命中',
    hitUntracked: '未跟踪工具，直通',
    unreviewableBash: '无法读取 Bash 命令参数（tool_input 解析失败），保守起见需要人工确认 [{tool}]',
    unreviewablePath: '无法读取 {tool} 目标路径（tool_input 解析失败），保守起见需要人工确认',
  },
  {
    usage: 'Usage: node dist/cli.js <guard|set|examine|optimize> <action>',
    guardUsage: 'Usage: node dist/cli.js guard <on|off|status|recent|stats|report|ping>',
    setUsage: 'Usage: node dist/cli.js set <set-key|show-key|clear-key|set-api|lang|history|reload>',
    examineUsage: 'Usage: node dist/cli.js examine <on|off|status|clear-old|clear-all>',
    optimizeUsage: 'Usage: node dist/cli.js optimize <status|analyze|list|rollback>',
    statsAuditCount: 'audit log records: {count} (learned-analysis data source)',
    statsExamineOff: 'Audit log is off (run cli.js examine on for persistent stats)',
    pingOk: 'API reachable',
    pingFail: 'API unreachable: {error}',
    unknownError: 'unknown error',
    showKeyEnvSet: 'env {name}: set (takes priority over local storage)',
    showKeyEnvUnset: 'env {name}: not set',
    showKeyStored: 'stored     : stored (AES-GCM encrypted at {dir}/api-key.json)',
    showKeyNoStore: 'stored     : (not stored)',
    showKeyLegacy: 'legacy     : {key} (plaintext legacy in config.json; re-store via set-key)',
    showKeyNoLegacy: 'legacy     : (none)',
    clearKeyDone: 'Locally stored API key cleared (encrypted file deleted; environment variables unaffected)',
    reloadNote: 'Config and rules are re-read on every hook process start',
    setLangInvalid: 'Invalid language value: {value} (available: zh, en)',
    setLangDone: 'Language set: {lang} (written to this config root)',
    optimizeAutoUnsupported: 'Usage: node dist/cli.js does not support set auto; edit autoAnalyzeEnabled in config.json manually',
    examineOn: 'Audit log enabled (local SQLite + field-level encryption; data never leaves this machine)',
    examineOff: 'Audit log disabled',
    examineClearedOld: 'Deleted {count} record(s) older than 30 days',
    examineClearedAll: 'Cleared all audit records',
    setKeyNeedsTty: 'set set-key needs an interactive terminal (the IDE built-in terminal works). Never paste the key into a chat — it would land in the session log.',
    setKeyEnvWarning: '⚠ Environment variable {name} is set and takes priority over local storage; storing anyway only serves environments without the variable.',
    wizardBanner: '—— auto-guard review endpoint wizard (press Enter at any step = keep the current value) ——',
    wizardBasePrompt: '[1/3] Review endpoint base URL (Enter = {base}): ',
    wizardModelPrompt: '[2/3] Model name (Enter = {model}): ',
    wizardKeyPrompt: '[3/3] API key (input hidden, Ctrl+C to cancel): ',
    wizardInvalidBase: 'Invalid base URL (must start with http(s)://): {value}; nothing saved',
    wizardCancelled: 'Cancelled',
    wizardInvalidKey: 'Invalid key (too short or contains whitespace); nothing stored',
    wizardSaved: '✅ Saved: endpoint {base} · model {model} · key {key} (encrypted to api-key.json)',
    wizardSavedHint: 'Effective immediately (new hook processes read it automatically); run guard ping to verify connectivity',
    deleteFailReviewerTitle: 'Reviewer failure — this deletion was not approved',
    deleteFailLlmTitle: 'The LLM rejected this deletion',
    deleteAskReason: '🛡️ auto-guard [deletion review] {flavor}: {reason}. Run it anyway? Decide in the confirmation dialog.',
    deleteNoDetail: 'no details provided',
    unknownDecisionDenied: 'Unknown decision; denied',
    failStdinNotJson: 'auto-guard: could not parse the hook input (stdin is not valid JSON); asking a human as a fail-safe',
    failBootstrap: 'auto-guard failed to start (check {configPath}): {error}; asking a human as a fail-safe',
    failDecide: 'auto-guard decision error: {error}; asking a human as a fail-safe',
    failUncaught: 'auto-guard uncaught error: {error}; asking a human as a fail-safe',
    passthroughDetail: 'passthrough/allow',
    deletionRetryHint: 'To proceed, retry the original command with a [删除理由] <your reason> marker appended; the LLM will review the reason.',
    hitRule: 'rule {pattern}: {reason}',
    hitRuleDefault: 'hit',
    hitSessionCache: 'session cache reuse: {reason}',
    hitCacheDefault: 'allowed earlier',
    hitPersistentCache: 'persistent cache reuse: {reason}',
    hitHistory: 'history audit allow: {reason}',
    hitHistoryDefault: 'similar command allowed before',
    hitLearned: 'learned rule allow: {reason}',
    hitLearnedDefault: 'template hit',
    hitUntracked: 'untracked tool; passthrough',
    unreviewableBash: 'Cannot read the Bash command parameters (tool_input failed to parse); asking a human as a fail-safe [{tool}]',
    unreviewablePath: 'Cannot read the {tool} target path (tool_input failed to parse); asking a human as a fail-safe',
  },
)

export type RuntimeMessageKey = Parameters<typeof catalog.message>[1]

/** Catalog lookup bound to one host: descriptor overrides first, then the shared catalog. */
export type HostMessage = (lang: Lang, key: RuntimeMessageKey, params?: Record<string, string | number>) => string

/** Build the message lookup for a host (no descriptor = the shared catalog alone). */
export function createHostMessage(descriptor?: HostDescriptor): HostMessage {
  return (lang, key, params = {}) => {
    const override = descriptor?.catalogOverride?.[key]?.[lang]
    if (override !== undefined) return interpolate(override, params)
    return catalog.message(lang, key, params)
  }
}
