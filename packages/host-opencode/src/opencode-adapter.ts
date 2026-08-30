/**
 * OpenCode adapter — the host-side half of the payload pipeline (ADR-0016).
 *
 * Two producers feed the spawned hook CLI (and the same GuardRequest shape
 * as the other hosts):
 *  - the `permission.asked` bus event (payload built here, ADR-0015
 *    revision: this is the only dispatch path that actually fires on
 *    OpenCode 1.18.x);
 *  - the `permission.ask` plugin hook (typed upstream; kept for forward
 *    compatibility).
 *
 * Both normalize to the hook CLI stdin shape {tool_name, tool_input,
 * session_id, cwd}. The stdin → GuardRequest side now lives in the shared
 * runtime, bound to OPENCODE_DESCRIPTOR; the guarded permission surface
 * below is the descriptor's guarded-tool table under its plugin-side name.
 */
import { isAbsolute, join } from 'node:path'
import { createExtraction, createHostMessage } from '@auto-guard/host-runtime'
import type { GuardRequest } from '@auto-guard/core'
import type { PermissionAskedProperties, SdkPermission } from './opencode-plugin-types.ts'
import { OPENCODE_DESCRIPTOR } from './descriptor.ts'

const extraction = createExtraction(OPENCODE_DESCRIPTOR, createHostMessage(OPENCODE_DESCRIPTOR))

/** Guarded permission keys and their guard-side tool names. `edit` covers edit/write/patch host-side. */
export const GUARDED_PERMISSION_TYPES: Record<string, string> = extraction.guardedToolNames

export const normalizeHookInput = extraction.normalizeHookInput
export const toGuardRequest = extraction.toGuardRequest
export type { GuardableExtraction } from '@auto-guard/host-runtime'

/** Hook CLI stdin payload (Claude-compatible field names, one object per request). */
export interface HookCliPayload {
  tool_name: string
  tool_input: Record<string, unknown>
  session_id: string
  cwd: string
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function patternList(pattern?: string | string[]): string[] {
  if (Array.isArray(pattern)) return pattern.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return firstString(pattern) ? [pattern as string] : []
}

/** Resolve the file path for edit/read: metadata.filepath first, then the worktree-relative pattern. */
function filePathFrom(metadata: Record<string, unknown> | undefined, patterns: string[], worktree: string): string | undefined {
  const raw = firstString(metadata?.filepath) ?? patterns[0]
  if (raw === undefined) return undefined
  return isAbsolute(raw) ? raw : join(worktree, raw)
}

/**
 * Build the hook CLI payload from a `permission.asked` event. Returns
 * `undefined` for permission types the guard does not cover (glob, grep,
 * webfetch, …) — those stay with the host's own permission flow.
 */
export function payloadFromAsked(props: PermissionAskedProperties, worktree: string): HookCliPayload | undefined {
  const tool = GUARDED_PERMISSION_TYPES[props.permission]
  if (!tool) return undefined
  const metadata = props.metadata ?? {}
  const patterns = props.patterns ?? []
  const toolInput: Record<string, unknown> =
    tool === 'bash'
      ? { command: firstString(metadata.command) ?? patterns[0] }
      : { file_path: filePathFrom(metadata, patterns, worktree) }
  if (tool !== 'bash') {
    const diff = firstString(metadata.diff)
    if (diff !== undefined) toolInput.content = diff
  }
  return { tool_name: tool, tool_input: toolInput, session_id: props.sessionID, cwd: worktree }
}

/** Build the hook CLI payload from the `permission.ask` hook input (SDK Permission shape). */
export function payloadFromSdkPermission(permission: SdkPermission, worktree: string): HookCliPayload | undefined {
  return payloadFromAsked(
    {
      id: permission.id,
      sessionID: permission.sessionID,
      permission: permission.type,
      patterns: patternList(permission.pattern),
      metadata: permission.metadata,
    },
    worktree,
  )
}

export type { GuardRequest }
