/**
 * Translate guard outcomes into the ZCode PreToolUse hook output protocol.
 *
 * Confirmed against the ZCode client bundle (strict zod schema): stdout must
 * parse as JSON with at most the documented keys, and `hookEventName` inside
 * `hookSpecificOutput` must equal exactly `"PreToolUse"` or the result is
 * discarded with a ToolExecutionFailed error.
 *
 * Mapping policy:
 *  - allow  → emit nothing and exit 0 (fast path; silence is the pass signal)
 *  - ask    → permissionDecision "ask"; ZCode renders its native prompt
 *  - deny   → permissionDecision "deny"; the reason reaches the model context
 */
import { notificationText, sourceTag } from '@auto-guard/core'
import type { Decision } from '@auto-guard/core'

export type HookAction =
  | { action: 'allow'; silent?: boolean }
  | { action: 'deny' | 'ask'; reason: string }

export interface HookSpecificOutput {
  hookEventName: 'PreToolUse'
  permissionDecision?: 'allow' | 'ask' | 'deny'
  permissionDecisionReason?: string
  additionalContext?: string
}

export interface HookOutput {
  hookSpecificOutput: HookSpecificOutput
}

const DELETION_RETRY_HINT = '如需继续，请在原命令后附带 [删除理由] <你的理由> 重试；理由将由 LLM 复核。'

/**
 * Build the printable reason for a deny/ask outcome. Uses the shared
 * notification text (layer tag + risk + reason) so the model sees which guard
 * layer decided.
 */
export function decisionReasonText(decision: Decision): string {
  return notificationText(decision)
}

/** Append the deletion-retry hint on the first directory-delete denial. */
export function withDeletionHint(reason: string): string {
  return `${reason} ${DELETION_RETRY_HINT}`
}

/**
 * Explain HOW a decision was reached, for the decision history / `guard recent`.
 * Rule hits name the exact pattern; cache hits name the cache layer plus the
 * original review reason; LLM decisions carry their verdict reason.
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

/** Serialize an action to the exact stdout contract. Empty string for allow. */
export function serializeHookOutput(action: HookAction): string {
  if (action.action === 'allow') return ''
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: action.action,
      permissionDecisionReason: action.reason,
    },
  }
  return JSON.stringify(output)
}
