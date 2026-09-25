/**
 * DSH adapter message catalog (zh / en) — remote settings-service messages
 * (analysis, rollback, audit export/rebuild), the pre-execute deletion ask
 * and the context-route notice labels (ADR-0011). Engine wording comes from
 * the core catalog. Key parity between languages is enforced by the type
 * system.
 */
import { defineCatalog, guardMessage, interpolate, isGuardMessageKey, type GuardMessageKey, type GuardMessageOverrides, type Lang } from '@auto-guard/core'

const catalog = defineCatalog(
  {
    analyzeNeedsExamine: '请先开启审查日志（examineEnabled）再分析',
    analyzeNeedsPassword: '请先设置审计密码（auditPassword）',
    analyzeDone: '学习规则分析完成：cacheable {count}',
    contextFallbackReason: '由 DSH Auto Guard 决定',
  },
  {
    analyzeNeedsExamine: 'Enable the audit log first (examineEnabled) before analyzing',
    analyzeNeedsPassword: 'Set the audit password first (auditPassword)',
    analyzeDone: 'Learned-rule analysis done: cacheable {count}',
    contextFallbackReason: 'decided by DSH Auto Guard',
  },
)

type DshChromeKey = Parameters<typeof catalog.message>[1]

/** DSH lookup key: guard-surface keys resolve from the core shared catalog (ADR-0023), the rest from this DSH-chrome catalog. */
export type DshMessageKey = DshChromeKey | GuardMessageKey

/** Build the DSH lookup: guard-surface wording rides data overrides (the ADR-0016 slot, ADR-0023). */
export function createDshMessage(overrides?: GuardMessageOverrides): DshMessage {
  return (lang, key, params = {}) => {
    if (isGuardMessageKey(key)) {
      const override = overrides?.[key]?.[lang]
      if (override !== undefined) return interpolate(override, params)
      return guardMessage(lang, key, params)
    }
    return catalog.message(lang, key, params)
  }
}

/** One bound host-surface message lookup: overrides first, then the shared catalog, then this catalog. */
export type DshMessage = (lang: Lang, key: DshMessageKey, params?: Record<string, string | number>) => string

/** Default DSH lookup (no overrides). */
export const dshMessage: DshMessage = createDshMessage()
