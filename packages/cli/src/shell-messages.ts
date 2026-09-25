/**
 * Management CLI message catalog (zh / en) — the shell's own rendering text
 * (aggregate status, stats/ping, key/endpoint receipts). Usage lines are
 * engine-owned text parameterized by the program name (ADR-0022); the
 * installer keeps its own catalog. Key parity between languages is enforced
 * by the type system (ADR-0011).
 */
import { defineCatalog, type Lang } from '@auto-guard/core'

const catalog = defineCatalog(
  {
    noRootFound: '未找到宿主配置根；请用 --config-root <path> 指定（例如 ~/.zcode/auto-guard）',
    aggregateHeader: '🛡️ auto-guard 多宿主状态',
    aggregateUnseeded: '◇ {label} — {root}：尚未播种（新开一次 {host} 会话后自动创建）',
    aggregateFooter: '（管理命令作用于单个宿主：加 --config-root ~/.<host>/auto-guard，或设 AUTO_GUARD_CONFIG_ROOT）',
    statsAuditCount: '审计库记录总数：{count}（学习分析数据源）',
    statsExamineOff: '审查日志未开启（auto-guard examine on 后才有持久统计）',
    pingOk: 'API 联通成功',
    pingFail: 'API 联通失败：{error}',
    unknownError: '未知错误',
    setKeyNeedsTty: 'set set-key 需要交互式终端（IDE 内置终端即可）。请不要把 Key 粘贴到对话中——那会进入会话日志。',
    showKeyEnvSet: 'env {name}: 已设置（优先于本地存储）',
    showKeyEnvUnset: 'env {name}: 未设置',
    showKeyStored: 'stored     : 已存储（AES-GCM 加密于 {root}/api-key.json）',
    showKeyNoStore: 'stored     : (未存储)',
    showKeyLegacy: 'legacy     : {key}（config.json 明文遗留，建议 set-key 重存）',
    showKeyNoLegacy: 'legacy     : (无)',
    clearKeyDone: '已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）',
    reloadNote: '配置与规则在每次 hook 进程启动时自动重读',
    setLangInvalid: '无效语言值：{value}（可用：zh、en）',
    setLangDone: '语言已设置：{lang}（已写入当前配置根）',
    examineOn: '审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）',
    examineOff: '审查日志已关闭',
    examineClearedOld: '已删除 {count} 条 30 天前记录',
    examineClearedAll: '已清空全部审查日志',
  },
  {
    noRootFound: 'No host config root found; pass --config-root <path> (e.g. ~/.zcode/auto-guard)',
    aggregateHeader: '🛡️ auto-guard multi-host status',
    aggregateUnseeded: '◇ {label} — {root}: not seeded yet (created automatically on the next {host} session)',
    aggregateFooter: '(Management commands act on a single host: add --config-root ~/.<host>/auto-guard, or set AUTO_GUARD_CONFIG_ROOT)',
    statsAuditCount: 'audit log records: {count} (learned-analysis data source)',
    statsExamineOff: 'Audit log is off (run auto-guard examine on for persistent stats)',
    pingOk: 'API reachable',
    pingFail: 'API unreachable: {error}',
    unknownError: 'unknown error',
    setKeyNeedsTty: 'set set-key needs an interactive terminal (the IDE built-in terminal works). Never paste the key into a chat — it would land in the session log.',
    showKeyEnvSet: 'env {name}: set (takes priority over local storage)',
    showKeyEnvUnset: 'env {name}: not set',
    showKeyStored: 'stored     : stored (AES-GCM encrypted at {root}/api-key.json)',
    showKeyNoStore: 'stored     : (not stored)',
    showKeyLegacy: 'legacy     : {key} (plaintext legacy in config.json; re-store via set-key)',
    showKeyNoLegacy: 'legacy     : (none)',
    clearKeyDone: 'Locally stored API key cleared (encrypted file deleted; environment variables unaffected)',
    reloadNote: 'Config and rules are re-read on every hook process start',
    setLangInvalid: 'Invalid language value: {value} (available: zh, en)',
    setLangDone: 'Language set: {lang} (written to this config root)',
    examineOn: 'Audit log enabled (local SQLite + field-level encryption; data never leaves this machine)',
    examineOff: 'Audit log disabled',
    examineClearedOld: 'Deleted {count} record(s) older than 30 days',
    examineClearedAll: 'Cleared all audit records',
  },
)

export type ShellMessageKey = Parameters<typeof catalog.message>[1]

/** Look up one management CLI message. */
export function shellMessage(lang: Lang, key: ShellMessageKey, params: Record<string, string | number> = {}): string {
  return catalog.message(lang, key, params)
}
