/**
 * Claude Code adapter surface — re-exported from the shared runtime, bound
 * to the Claude Code descriptor (ADR-0016). The names stay for the host
 * tests and the cross-host conformance suite.
 */
import { createExtraction, createHostMessage } from '@auto-guard/host-runtime'
import { CLAUDE_DESCRIPTOR } from './descriptor.ts'

const extraction = createExtraction(CLAUDE_DESCRIPTOR, createHostMessage(CLAUDE_DESCRIPTOR))

/** Guarded tools and their guard-side names. NotebookEdit is the .ipynb write path. */
export const GUARDED_TOOL_NAMES: Record<string, string> = extraction.guardedToolNames

export const normalizeHookInput = extraction.normalizeHookInput
export const toGuardRequest = extraction.toGuardRequest
export type { GuardableExtraction } from '@auto-guard/host-runtime'
