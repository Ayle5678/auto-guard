/**
 * Default exit wire (ADR-0016): the Claude-compatible PreToolUse protocol
 * shared by zcode / claude / qoder / codex.
 *
 *   allow → emit nothing and exit 0 (silence is the pass signal)
 *   ask   → permissionDecision "ask"; the host renders its native prompt
 *   deny  → permissionDecision "deny"; the reason reaches the model context
 *
 * Confirmed against the ZCode client bundle (strict zod schema): stdout must
 * parse as JSON with at most the documented keys, and `hookEventName` inside
 * `hookSpecificOutput` must equal exactly `"PreToolUse"` or the result is
 * discarded with a ToolExecutionFailed error. Claude Code and Qoder speak
 * dialects of the same shape.
 *
 * SPEC 0015: codex parses `permissionDecision:"ask"` but does not support it
 * — the hook run is marked failed and the tool call CONTINUES (fail-open).
 * A host declaring `headlessFallback: 'deny'` (ADR-0007, the dsh precedent)
 * therefore gets its ask outcomes translated to deny by
 * {@link createDefaultWire}, with the reason carrying a host-neutral note;
 * hosts delegating asks to their permission system (`headlessFallback:
 * 'host'`) keep the plain passthrough of `defaultWire`.
 */
import type { Lang } from '@auto-guard/core'
import type { WireOutcome, WireSerializer } from './descriptor.ts'
import type { HostCapabilities } from '@auto-guard/core'
import { createRuntimeCatalogMessage } from './messages.ts'

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

/** Serialize an action to the exact stdout contract. Empty string for allow. */
export function serializeHookOutcome(outcome: WireOutcome): string {
  if (outcome.action === 'allow') return ''
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: outcome.action,
      permissionDecisionReason: outcome.reason,
    },
  }
  return JSON.stringify(output)
}

/** The plain protocol wire: asks travel verbatim (host renders its prompt). */
export const defaultWire: WireSerializer = { serialize: serializeHookOutcome }

/**
 * Capability-aware default wire (SPEC 0015): identical to {@link defaultWire}
 * unless the host declares `headlessFallback: 'deny'`, in which case every
 * ask lands as a deny — never as the fail-open "ask" that codex would
 * discard-and-continue. The appended note tells the user why the guard went
 * straight to denial instead of a confirmation prompt.
 */
export function createDefaultWire(capabilities: Pick<HostCapabilities, 'headlessFallback'>): WireSerializer {
  if (capabilities.headlessFallback !== 'deny') return defaultWire
  const message = createRuntimeCatalogMessage()
  return {
    serialize(outcome: WireOutcome, lang?: Lang): string {
      if (outcome.action !== 'ask') return serializeHookOutcome(outcome)
      return serializeHookOutcome({
        action: 'deny',
        reason: `${outcome.reason ?? ''} ${message(lang ?? 'zh', 'askDeniedNoPrompt')}`.trim(),
      })
    },
  }
}

/** Back-compat alias for the pre-runtime name (host facades re-export it). */
export const serializeHookOutput = serializeHookOutcome
