/**
 * Default exit wire (ADR-0016): the Claude-compatible PreToolUse protocol
 * shared by zcode / claude / qoder.
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
 */
import type { WireOutcome, WireSerializer } from './descriptor.ts'

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

export const defaultWire: WireSerializer = { serialize: serializeHookOutcome }

/** Back-compat alias for the pre-runtime name (host facades re-export it). */
export const serializeHookOutput = serializeHookOutcome
