/**
 * ZCode adapter surface — re-exported from the shared runtime, bound to the
 * ZCode descriptor (ADR-0016). The pre-runtime zcode-adapter logic moved to
 * host-runtime/extraction; these names stay for the host tests and the
 * cross-host conformance suite.
 */
import { createExtraction, createHostMessage } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

const extraction = createExtraction(ZCODE_DESCRIPTOR, createHostMessage(ZCODE_DESCRIPTOR))

/** Guarded tools and their guard-side names, mirroring pi-auto-guard's adapter. */
export const GUARDED_TOOL_NAMES: Record<string, string> = extraction.guardedToolNames

export const normalizeHookInput = extraction.normalizeHookInput
export const toGuardRequest = extraction.toGuardRequest
export type { GuardableExtraction } from '@auto-guard/host-runtime'
