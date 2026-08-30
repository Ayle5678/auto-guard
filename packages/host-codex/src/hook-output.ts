/**
 * Codex hook output surface — re-exported from the shared runtime (ADR-0016).
 * The wire half is the default `hookSpecificOutput` dialect (with the
 * capability-driven ask→deny translation, SPEC 0015); the text half is the
 * shared decision renderer with the runtime catalog wording.
 */
import { createHostMessage, createDecisionRender, serializeHookOutput, createDefaultWire } from '@auto-guard/host-runtime'
import type { Decision, Lang } from '@auto-guard/core'
import { CODEX_CAPABILITIES } from './codex-capabilities.ts'

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

/**
 * The codex wire: the default dialect with ask outcomes rendered as deny
 * (codex discards-and-continues on `permissionDecision:"ask"`).
 */
export const codexWire = createDefaultWire(CODEX_CAPABILITIES)
