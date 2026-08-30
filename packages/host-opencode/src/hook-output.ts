/**
 * OpenCode hook output surface — re-exported from the shared runtime
 * (ADR-0016). The `{status,reason}` verdict contract (serialize / parse /
 * reply mapping) is the opencode wire; the text half is the shared decision
 * renderer. plugin.ts consumes these exact names.
 */
import { createHostMessage, createDecisionRender } from '@auto-guard/host-runtime'
import type { Decision, Lang } from '@auto-guard/core'

export {
  opencodeWire,
  serializeVerdict,
  parseVerdict,
  statusToReply,
  statusToOutputStatus,
  type GuardStatus,
  type GuardVerdict,
} from '@auto-guard/host-runtime'

const render = createDecisionRender(createHostMessage())

/** Build the printable reason for a deny/ask outcome (layer tag + risk + reason). */
export function decisionReasonText(decision: Decision, lang: Lang = 'zh'): string {
  return render.decisionReasonText(decision, lang)
}

/** Append the deletion-retry hint on the first directory-delete denial. */
export function withDeletionHint(reason: string, lang: Lang = 'zh'): string {
  return render.withDeletionHint(reason, lang)
}

/** Explain HOW a decision was reached, for the decision history / `guard recent`. */
export function hitDetail(decision: Decision, matchedPattern: string | undefined, lang: Lang = 'zh'): string {
  return render.hitDetail(decision, matchedPattern, lang)
}
