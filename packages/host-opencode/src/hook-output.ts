/**
 * Translate guard outcomes into the spawned hook CLI's stdout contract.
 *
 * Unlike the claude/zcode process hooks (silence = allow), the OpenCode
 * plugin side needs an explicit verdict for every call it feeds the CLI:
 *   {"status":"allow"}                      — plugin replies "once" (auto-approve)
 *   {"status":"deny","reason":"…"}          — plugin replies "reject" with the reason
 *   {"status":"ask","reason":"…"}           — plugin does not reply; native TUI asks
 * Anything unparseable is treated by the plugin as `ask` (host TUI decides).
 */
import { notificationText } from '@auto-guard/core'
import type { Decision } from '@auto-guard/core'

export type GuardStatus = 'allow' | 'deny' | 'ask'

export interface GuardVerdict {
  status: GuardStatus
  reason?: string
}

const DELETION_RETRY_HINT = '如需继续，请在原命令后附带 [删除理由] <你的理由> 重试；理由将由 LLM 复核。'

export function decisionReasonText(decision: Decision): string {
  return notificationText(decision)
}

/** Append the deletion-retry hint on the first directory-delete denial. */
export function withDeletionHint(reason: string): string {
  return `${reason} ${DELETION_RETRY_HINT}`
}

/**
 * Explain HOW a decision was reached, for the decision history / `guard recent`.
 * Mirrors the claude/zcode adapters so all hosts render equivalent detail.
 */
export function hitDetail(decision: Decision, matchedPattern?: string): string {
  if (matchedPattern) return `规则 ${matchedPattern}：${decision.reason ?? '命中'}`
  switch (decision.source) {
    case 'session-cache':
      return `会话缓存复用：${decision.reason ?? '此前已放行'}`
    case 'persistent-cache':
      return `持久缓存复用：${decision.reason ?? '此前已放行'}`
    case 'history':
      return `历史审计放行：${decision.reason ?? '相似命令历史 allow'}`
    case 'learned':
      return `学习规则放行：${decision.reason ?? '模板命中'}`
    case 'passthrough':
      return '未跟踪工具，直通'
    default:
      return (decision.reason ?? '').slice(0, 120)
  }
}

/** Serialize a verdict to the exact stdout contract (always one JSON object). */
export function serializeVerdict(verdict: GuardVerdict): string {
  return JSON.stringify(verdict)
}

/** Parse and validate plugin-side; `undefined` when stdout is not a usable verdict. */
export function parseVerdict(stdout: string): GuardVerdict | undefined {
  try {
    const parsed = JSON.parse(stdout) as { status?: unknown; reason?: unknown }
    if (parsed !== null && typeof parsed === 'object' && (parsed.status === 'allow' || parsed.status === 'deny' || parsed.status === 'ask')) {
      return { status: parsed.status, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** How a guard status maps onto the OpenCode reply API (undefined = no reply, TUI asks). */
export function statusToReply(status: GuardStatus): 'once' | 'reject' | undefined {
  if (status === 'allow') return 'once'
  if (status === 'deny') return 'reject'
  return undefined
}

/** How a guard status maps onto the `permission.ask` output.status (undefined = leave untouched, TUI asks). */
export function statusToOutputStatus(status: GuardStatus): 'allow' | 'deny' | undefined {
  if (status === 'allow') return 'allow'
  if (status === 'deny') return 'deny'
  return undefined
}
