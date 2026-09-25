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
import { defineCatalog, guardMessage, interpolate, isGuardMessageKey, type GuardMessageKey, type Lang } from '@auto-guard/core'
import type { HostDescriptor } from './descriptor.ts'

const catalog = defineCatalog(
  {
    wizardBanner: '—— auto-guard 审查端点配置向导（任意一步直接回车 = 保持当前值）——',
    wizardBasePrompt: '[1/3] 审查端点 base URL（回车 = {base}）: ',
    wizardModelPrompt: '[2/3] 模型名称（回车 = {model}）: ',
    wizardKeyPrompt: '[3/3] API Key（输入不回显，Ctrl+C 取消）: ',
    wizardInvalidBase: 'base URL 无效（需要 http(s):// 开头）：{value}，未保存',
    wizardCancelled: '已取消',
    wizardInvalidKey: 'Key 无效（过短或含空白），未存储',
    wizardSaved: '✅ 已保存：端点 {base} · 模型 {model} · Key {key}（加密落盘 api-key.json）',
    wizardSavedHint: '立即生效（新 hook 进程自动读取）；可运行 guard ping 验证连通性',
    failStdinNotJson: 'auto-guard：无法解析 hook 输入（stdin 不是合法 JSON），保守起见需要人工确认',
    failBootstrap: 'auto-guard 初始化失败（检查 {configPath}）：{error}；保守起见需要人工确认',
    failDecide: 'auto-guard 裁决过程异常：{error}；保守起见需要人工确认',
    failUncaught: 'auto-guard 未捕获异常：{error}；保守起见需要人工确认',
    passthroughDetail: '直通/放行',
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
    askDeniedNoPrompt: '【本宿主无法弹出人工确认，auto-guard 已按拒绝处理；如确认安全，请手动执行该命令，或将其加入 userConfirmed 规则】',
    askEscapeHint: '〔本会话记忆〕另开终端运行 auto-guard guard ask：可“本会话都同意”或“本会话都拒绝（可附理由）”；也可选拒绝后直接在对话里说明你的需求。',
    askModelContext: 'auto-guard 已请求人工确认。若用户拒绝并说明理由：按理由调整方案，不要原样重试同一条命令。若用户表示本会话都不允许此类命令：先运行 auto-guard guard ask list 查看序号，再运行 auto-guard guard ask deny <序号> --reason "<用户的理由>" 记入本会话记忆。',
  },
  {
    wizardBanner: '—— auto-guard review endpoint wizard (press Enter at any step = keep the current value) ——',
    wizardBasePrompt: '[1/3] Review endpoint base URL (Enter = {base}): ',
    wizardModelPrompt: '[2/3] Model name (Enter = {model}): ',
    wizardKeyPrompt: '[3/3] API key (input hidden, Ctrl+C to cancel): ',
    wizardInvalidBase: 'Invalid base URL (must start with http(s)://): {value}; nothing saved',
    wizardCancelled: 'Cancelled',
    wizardInvalidKey: 'Invalid key (too short or contains whitespace); nothing stored',
    wizardSaved: '✅ Saved: endpoint {base} · model {model} · key {key} (encrypted to api-key.json)',
    wizardSavedHint: 'Effective immediately (new hook processes read it automatically); run guard ping to verify connectivity',
    failStdinNotJson: 'auto-guard: could not parse the hook input (stdin is not valid JSON); asking a human as a fail-safe',
    failBootstrap: 'auto-guard failed to start (check {configPath}): {error}; asking a human as a fail-safe',
    failDecide: 'auto-guard decision error: {error}; asking a human as a fail-safe',
    failUncaught: 'auto-guard uncaught error: {error}; asking a human as a fail-safe',
    passthroughDetail: 'passthrough/allow',
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
    askDeniedNoPrompt: '[This host cannot surface a confirmation prompt, so auto-guard denied the call; if it is safe, run it manually or add it to the userConfirmed rules]',
    askEscapeHint: '[Session memory] Run "auto-guard guard ask" in another terminal to allow or deny for the rest of this session (reason optional), or pick Deny and state your need in the chat.',
    askModelContext: 'auto-guard has asked a human to confirm. If the user denies with a reason: adapt to the reason and never retry the same command verbatim. If the user says this kind of command is denied for the rest of the session: run "auto-guard guard ask list" for the index, then "auto-guard guard ask deny <index> --reason \'<their reason>\'" to record it in session memory.',
  },
)

type RuntimeChromeKey = Parameters<typeof catalog.message>[1]

/** Runtime lookup key: guard-surface keys resolve from the core shared catalog (ADR-0023), the rest from this chrome catalog. */
export type RuntimeMessageKey = RuntimeChromeKey | GuardMessageKey

/** Catalog lookup bound to one host: descriptor overrides first, then the shared catalog. */
export type HostMessage = (lang: Lang, key: RuntimeMessageKey, params?: Record<string, string | number>) => string

/** Build the message lookup for a host (no descriptor = the shared catalog alone). */
export function createHostMessage(descriptor?: HostDescriptor): HostMessage {
  return (lang, key, params = {}) => {
    const override = descriptor?.catalogOverride?.[key]?.[lang]
    if (override !== undefined) return interpolate(override, params)
    return isGuardMessageKey(key) ? guardMessage(lang, key, params) : catalog.message(lang, key, params)
  }
}

/** Shared-catalog lookup without a host binding (SPEC 0015: the deny-fallback wire note). */
export function createRuntimeCatalogMessage(): HostMessage {
  return (lang, key, params = {}) =>
    isGuardMessageKey(key) ? guardMessage(lang, key, params) : catalog.message(lang, key, params)
}
