/**
 * DSH adapter message catalog (zh / en) — remote settings-service messages
 * (analysis, rollback, audit export/rebuild), the pre-execute deletion ask
 * and the context-route notice labels (ADR-0011). Engine wording comes from
 * the core catalog. Key parity between languages is enforced by the type
 * system.
 */
import { defineCatalog, type Lang } from '@auto-guard/core'

const catalog = defineCatalog(
  {
    analyzeNeedsExamine: '请先开启审查日志（examineEnabled）再分析',
    analyzeNeedsPassword: '请先设置审计密码（auditPassword）',
    analyzeDone: '学习规则分析完成：cacheable {count}',
    rollbackNone: '没有可恢复的 backup',
    rollbackDone: '已从 backup 恢复学习规则',
    exportUnsupported: '当前审计实现不支持明文导出（Light 降级模式）',
    exportDone: '已导出明文审计库到 ~/.dsh/auto-guard/audit.export.db',
    exportFailed: '明文导出失败，请确认已设置审计密码',
    createNeedsPassword: '请先设置审计密码',
    createUnsupported: '当前审计实现不支持重建（Light 降级模式）',
    createDone: '已创建新的空审计库；旧加密库已保留为 orphan 文件',
    createFailed: '重建审计库失败',
    deleteFailReviewerTitle: '审查器故障，这次删除未过审',
    deleteFailLlmTitle: 'LLM 否决了这次删除',
    deleteFailDefaultReason: '审查未通过',
    deleteRunAnyway: '仍要执行吗？',
    contextAllow: '✅ 放行',
    contextDeny: '⛔ 拦截',
    contextAsk: '❓ 询问',
    contextFallbackReason: '由 DSH Auto Guard 决定',
    pingNoDirectEndpoint: '未配置直连审查端点',
  },
  {
    analyzeNeedsExamine: 'Enable the audit log first (examineEnabled) before analyzing',
    analyzeNeedsPassword: 'Set the audit password first (auditPassword)',
    analyzeDone: 'Learned-rule analysis done: cacheable {count}',
    rollbackNone: 'No backup to restore',
    rollbackDone: 'Learned rules restored from backup',
    exportUnsupported: 'The current audit implementation does not support plaintext export (Light fallback mode)',
    exportDone: 'Plaintext audit database exported to ~/.dsh/auto-guard/audit.export.db',
    exportFailed: 'Plaintext export failed; make sure the audit password is set',
    createNeedsPassword: 'Set the audit password first',
    createUnsupported: 'The current audit implementation does not support rebuilding (Light fallback mode)',
    createDone: 'New empty audit database created; the old encrypted database is kept as an orphan file',
    createFailed: 'Failed to rebuild the audit database',
    deleteFailReviewerTitle: 'Reviewer failure — this deletion was not approved',
    deleteFailLlmTitle: 'The LLM vetoed this deletion',
    deleteFailDefaultReason: 'Review not passed',
    deleteRunAnyway: 'Run it anyway?',
    contextAllow: '✅ allow',
    contextDeny: '⛔ deny',
    contextAsk: '❓ ask',
    contextFallbackReason: 'decided by DSH Auto Guard',
    pingNoDirectEndpoint: 'No direct review endpoint configured',
  },
)

export type DshMessageKey = Parameters<typeof catalog.message>[1]

/** Look up one DSH-surface message. */
export function dshMessage(lang: Lang, key: DshMessageKey, params: Record<string, string | number> = {}): string {
  return catalog.message(lang, key, params)
}
