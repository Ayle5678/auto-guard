/**
 * DSH adapter message catalog (zh / en) — remote settings-service messages
 * (analysis, rollback, audit export/rebuild), the pre-execute deletion ask
 * and the context-route notice labels (ADR-0011). Engine wording comes from
 * the core catalog. Key parity between languages is enforced by the type
 * system.
 */
import { defineCatalog, guardMessage, isGuardMessageKey, type GuardMessageKey, type Lang } from '@auto-guard/core'

const catalog = defineCatalog(
  {
    analyzeNeedsExamine: '请先开启审查日志（examineEnabled）再分析',
    analyzeNeedsPassword: '请先设置审计密码（auditPassword）',
    analyzeDone: '学习规则分析完成：cacheable {count}',
    rollbackNone: '没有可恢复的 backup',
    rollbackDone: '已从 backup 恢复学习规则',
    contextAllow: '✅ 放行',
    contextDeny: '⛔ 拦截',
    contextAsk: '❓ 询问',
    contextFallbackReason: '由 DSH Auto Guard 决定',
  },
  {
    analyzeNeedsExamine: 'Enable the audit log first (examineEnabled) before analyzing',
    analyzeNeedsPassword: 'Set the audit password first (auditPassword)',
    analyzeDone: 'Learned-rule analysis done: cacheable {count}',
    rollbackNone: 'No backup to restore',
    rollbackDone: 'Learned rules restored from backup',
    contextAllow: '✅ allow',
    contextDeny: '⛔ deny',
    contextAsk: '❓ ask',
    contextFallbackReason: 'decided by DSH Auto Guard',
  },
)

type DshChromeKey = Parameters<typeof catalog.message>[1]

/** DSH lookup key: guard-surface keys resolve from the core shared catalog (ADR-0023), the rest from this DSH-chrome catalog. */
export type DshMessageKey = DshChromeKey | GuardMessageKey

/** Look up one DSH-surface message. */
export function dshMessage(lang: Lang, key: DshMessageKey, params: Record<string, string | number> = {}): string {
  return isGuardMessageKey(key) ? guardMessage(lang, key, params) : catalog.message(lang, key, params)
}
