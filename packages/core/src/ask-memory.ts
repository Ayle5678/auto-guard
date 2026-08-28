/**
 * Pure ask four-state memory logic.
 *
 * The interactive layer renders the choices and collects an optional deny
 * reason; this module decides whether a choice may be remembered and what to
 * write into the session cache. Kept dependency-free so it can be unit-tested
 * without a Pi runtime.
 */
import type { Decision } from './types.ts'

export const ASK_MEMORY_OPTIONS = [
  '同意（仅本次）',
  '本会话都同意',
  '拒绝（可输原因）',
  '本会话都拒绝（可输原因）',
] as const

export type AskMemoryOption = (typeof ASK_MEMORY_OPTIONS)[number]

export interface AskMemoryResolution {
  action: 'allow' | 'block'
  /** When set, write this entry into the session cache (alive until session end). */
  cacheWrite?: { kind: 'allow' | 'deny'; reason?: string }
  /** Reason to surface for a block, when the user supplied one. */
  reason?: string
}

/** True when an ask decision may use the four-state memory UI. */
export function canRememberAsk(decision: Decision): boolean {
  return (
    decision.kind === 'ask' &&
    decision.source === 'llm' &&
    decision.reviewerFailed !== true &&
    decision.risk !== 'high'
  )
}

/** Resolve a four-state choice into an action and optional session memory write. */
export function resolveAskMemory(choice: AskMemoryOption | string | undefined, reason?: string): AskMemoryResolution {
  switch (choice) {
    case '同意（仅本次）':
      return { action: 'allow' }
    case '本会话都同意':
      return { action: 'allow', cacheWrite: { kind: 'allow' } }
    case '拒绝（可输原因）':
      return { action: 'block', reason }
    case '本会话都拒绝（可输原因）':
      return { action: 'block', cacheWrite: { kind: 'deny', reason }, reason }
    default:
      return { action: 'block' }
  }
}
