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
 *
 * Text resolves from the ZCode catalog with the effective language (ADR-0011);
 * the `[删除理由]` marker inside the retry hint is protocol and stays Chinese.
 */
import { notificationText, type Lang } from '@auto-guard/core'
import type { Decision } from '@auto-guard/core'
import { zcMessage } from './messages.ts'

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

/**
 * Build the printable reason for a deny/ask outcome. Uses the shared
 * notification text (layer tag + risk + reason) so the model sees which guard
 * layer decided.
 */
export function decisionReasonText(decision: Decision, lang: Lang = 'zh'): string {
  return notificationText(decision, lang)
}

/** Append the deletion-retry hint on the first directory-delete denial. */
export function withDeletionHint(reason: string, lang: Lang = 'zh'): string {
  return `${reason} ${zcMessage(lang, 'deletionRetryHint')}`
}

/**
 * Explain HOW a decision was reached, for the decision history / `guard recent`.
 * Rule hits name the exact pattern; cache hits name the cache layer plus the
 * original review reason; LLM decisions carry their verdict reason.
 */
export function hitDetail(decision: Decision, matchedPattern: string | undefined, lang: Lang = 'zh'): string {
  if (matchedPattern) return zcMessage(lang, 'hitRule', { pattern: matchedPattern, reason: decision.reason ?? zcMessage(lang, 'hitRuleDefault') })
  switch (decision.source) {
    case 'session-cache':
      return zcMessage(lang, 'hitSessionCache', { reason: decision.reason ?? zcMessage(lang, 'hitCacheDefault') })
    case 'persistent-cache':
      return zcMessage(lang, 'hitPersistentCache', { reason: decision.reason ?? zcMessage(lang, 'hitCacheDefault') })
    case 'history':
      return zcMessage(lang, 'hitHistory', { reason: decision.reason ?? zcMessage(lang, 'hitHistoryDefault') })
    case 'learned':
      return zcMessage(lang, 'hitLearned', { reason: decision.reason ?? zcMessage(lang, 'hitLearnedDefault') })
    case 'passthrough':
      return zcMessage(lang, 'hitUntracked')
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
