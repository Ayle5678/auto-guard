/**
 * Pure ask four-state memory logic.
 *
 * The interactive layer renders the choices and collects an optional deny
 * reason; this module decides whether a choice may be remembered and what to
 * write into the session cache. Kept dependency-free so it can be unit-tested
 * without a Pi runtime.
 *
 * Options are structured values with bilingual labels (ADR-0011): hosts render
 * the label for the effective language and map the returned label back to the
 * value; core matches values (and, for backward compatibility, either label)
 * so display text is never the semantic key. Unresolvable choices still block.
 */
import type { Lang } from './lang.ts'
import type { Decision } from './types.ts'

/** The four semantic states behind the ask dialog. */
export type AskMemoryValue = 'allow-once' | 'allow-session' | 'deny-once' | 'deny-session'

export interface AskMemoryOption {
  value: AskMemoryValue
  zh: string
  en: string
}

export const ASK_MEMORY_OPTIONS: readonly AskMemoryOption[] = [
  { value: 'allow-once', zh: '同意（仅本次）', en: 'Allow (just this once)' },
  { value: 'allow-session', zh: '本会话都同意', en: 'Allow for the rest of this session' },
  { value: 'deny-once', zh: '拒绝（可输原因）', en: 'Deny (reason optional)' },
  { value: 'deny-session', zh: '本会话都拒绝（可输原因）', en: 'Deny for the rest of this session (reason optional)' },
] as const

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

/** Labels for one language, in display order. */
export function askMemoryLabels(lang: Lang): string[] {
  return ASK_MEMORY_OPTIONS.map((option) => option[lang])
}

/** Map a UI-returned label (either language) or a raw value to its semantic value; unresolvable input yields undefined. */
export function askMemoryValueOfChoice(choice: string): AskMemoryValue | undefined {
  for (const option of ASK_MEMORY_OPTIONS) {
    if (option.value === choice || option.zh === choice || option.en === choice) return option.value
  }
  return undefined
}

/** True when the value is one of the two deny states (the host asks for a reason on those). */
export function isDenyAskValue(value: AskMemoryValue): boolean {
  return value === 'deny-once' || value === 'deny-session'
}

/** Resolve a four-state choice into an action and optional session memory write. */
export function resolveAskMemory(choice: AskMemoryValue | string | undefined, reason?: string): AskMemoryResolution {
  const value = choice !== undefined ? askMemoryValueOfChoice(choice) : undefined
  switch (value) {
    case 'allow-once':
      return { action: 'allow' }
    case 'allow-session':
      return { action: 'allow', cacheWrite: { kind: 'allow' } }
    case 'deny-once':
      return { action: 'block', reason }
    case 'deny-session':
      return { action: 'block', cacheWrite: { kind: 'deny', reason }, reason }
    default:
      return { action: 'block' }
  }
}
