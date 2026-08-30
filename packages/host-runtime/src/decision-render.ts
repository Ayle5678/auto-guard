/**
 * Translate guard decisions into printable reasons and status detail
 * (the pre-runtime `hook-output.ts` text half). The wire half lives in the
 * serializer slot; this half is shared wording driven by the host message
 * lookup (ADR-0011). The `[删除理由]` marker inside the retry hint is
 * protocol and stays Chinese.
 */
import { notificationText } from '@auto-guard/core'
import type { Decision, Lang } from '@auto-guard/core'
import type { HostMessage } from './messages.ts'
import { createHostMessage } from './messages.ts'

/** Build the decision→text renderer bound to one host's message lookup. */
export function createDecisionRender(message: HostMessage) {
  /** Build the printable reason for a deny/ask outcome (layer tag + risk + reason). */
  function decisionReasonText(decision: Decision, lang: Lang = 'zh'): string {
    return notificationText(decision, lang)
  }

  /** Append the deletion-retry hint on the first directory-delete denial. */
  function withDeletionHint(reason: string, lang: Lang = 'zh'): string {
    return `${reason} ${message(lang, 'deletionRetryHint')}`
  }

  /**
   * Explain HOW a decision was reached, for the decision history / `guard recent`.
   * Rule hits name the exact pattern; cache hits name the cache layer plus the
   * original review reason; LLM decisions carry their verdict reason.
   */
  function hitDetail(decision: Decision, matchedPattern: string | undefined, lang: Lang = 'zh'): string {
    if (matchedPattern) return message(lang, 'hitRule', { pattern: matchedPattern, reason: decision.reason ?? message(lang, 'hitRuleDefault') })
    switch (decision.source) {
      case 'session-cache':
        return message(lang, 'hitSessionCache', { reason: decision.reason ?? message(lang, 'hitCacheDefault') })
      case 'persistent-cache':
        return message(lang, 'hitPersistentCache', { reason: decision.reason ?? message(lang, 'hitCacheDefault') })
      case 'history':
        return message(lang, 'hitHistory', { reason: decision.reason ?? message(lang, 'hitHistoryDefault') })
      case 'learned':
        return message(lang, 'hitLearned', { reason: decision.reason ?? message(lang, 'hitLearnedDefault') })
      case 'passthrough':
        return message(lang, 'hitUntracked')
      default:
        return (decision.reason ?? '').slice(0, 120)
    }
  }

  return { decisionReasonText, withDeletionHint, hitDetail }
}

/** Shared-catalog renderer for tests and facades (zh fallback, no overrides). */
export const { decisionReasonText, withDeletionHint, hitDetail } = createDecisionRender(createHostMessage())
