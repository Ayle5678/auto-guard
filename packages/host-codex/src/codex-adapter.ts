/**
 * Codex adapter surface — re-exported from the shared runtime, bound to the
 * Codex descriptor (ADR-0016): payload normalization, GuardRequest
 * extraction (including the SPEC 0015 patch-text path parsing) and the
 * message catalog with no codex-specific overrides.
 */
import { createExtraction, createHostMessage } from '@auto-guard/host-runtime'
import { CODEX_DESCRIPTOR } from './descriptor.ts'

const extraction = createExtraction(CODEX_DESCRIPTOR, createHostMessage(CODEX_DESCRIPTOR))

/** Guarded tools and their guard-side names, mirroring the other hook hosts. */
export const GUARDED_TOOL_NAMES: Record<string, string> = extraction.guardedToolNames

export const normalizeHookInput = extraction.normalizeHookInput
export const toGuardRequest = extraction.toGuardRequest
export type { GuardableExtraction } from '@auto-guard/host-runtime'
