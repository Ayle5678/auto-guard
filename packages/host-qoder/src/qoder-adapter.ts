/**
 * Qoder adapter surface — re-exported from the shared runtime, bound to the
 * Qoder descriptor (ADR-0016). The names stay for the host tests and the
 * cross-host conformance suite. The SPEC 0012 `delete_file` rm synthesis is
 * descriptor data (`synthesizeCommand: 'rm'`); the shell-word encoder is
 * re-exported under its pre-runtime name.
 */
import { createExtraction, createHostMessage, synthesizeShellCommand } from '@auto-guard/host-runtime'
import { QODER_DESCRIPTOR } from './descriptor.ts'

const extraction = createExtraction(QODER_DESCRIPTOR, createHostMessage(QODER_DESCRIPTOR))

/** Guarded tools and their guard-side names, including delete_file (SPEC 0012). */
export const GUARDED_TOOL_NAMES: Record<string, string> = extraction.guardedToolNames

export const normalizeHookInput = extraction.normalizeHookInput
export const toGuardRequest = extraction.toGuardRequest

/** Encode a path as one safe double-quoted shell word (SPEC 0012). */
export const synthesizeDeleteCommand = synthesizeShellCommand
export type { GuardableExtraction } from '@auto-guard/host-runtime'
