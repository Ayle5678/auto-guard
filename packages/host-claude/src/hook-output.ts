/**
 * Claude Code hook output surface — re-exported from the shared runtime
 * (ADR-0016). The wire half is the default `hookSpecificOutput` dialect
 * (verified against code.claude.com/docs/en/hooks); the text half is the
 * shared decision renderer.
 */
import { createHostMessage, createDecisionRender, serializeHookOutput } from '@auto-guard/host-runtime'
import type { Decision, Lang } from '@auto-guard/core'

export { serializeHookOutput }
export type { HookAction, HookOutput, HookSpecificOutput } from '@auto-guard/host-runtime'

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
