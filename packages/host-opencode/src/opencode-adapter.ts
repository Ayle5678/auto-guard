/**
 * Adapter mapping OpenCode permission requests to the guard service input.
 *
 * Two producers feed the same spawned hook CLI (and the same GuardRequest
 * shape as the claude/zcode adapters):
 *  - the `permission.asked` bus event (payload built by the plugin, ADR-0011
 *    revision: this is the only dispatch path that actually fires on
 *    OpenCode 1.18.x);
 *  - the `permission.ask` plugin hook (typed upstream; kept for forward
 *    compatibility).
 *
 * Both normalize to the hook CLI stdin shape {tool_name, tool_input,
 * session_id, cwd}; this module also holds the stdin→GuardRequest side used
 * by the hook CLI process itself.
 */
import { isAbsolute, join } from 'node:path'
import type { GuardRequest } from '@auto-guard/core'
import type { PermissionAskedProperties, SdkPermission } from './opencode-plugin-types.ts'

/** Guarded permission keys and their guard-side tool names. `edit` covers edit/write/patch host-side. */
export const GUARDED_PERMISSION_TYPES: Record<string, string> = {
  bash: 'bash',
  edit: 'edit',
  read: 'read',
}

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

export interface OpencodeHookInput {
  session_id?: string
  tool_name?: string
  toolName?: string
  tool_input?: Record<string, unknown>
  toolInput?: Record<string, unknown>
  cwd?: string
}

export function normalizeHookInput(raw: unknown): OpencodeHookInput {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  const toolInput =
    input.tool_input && typeof input.tool_input === 'object'
      ? (input.tool_input as Record<string, unknown>)
      : input.toolInput && typeof input.toolInput === 'object'
        ? (input.toolInput as Record<string, unknown>)
        : undefined
  return {
    session_id: firstString(input.session_id),
    tool_name: firstString(input.tool_name) ?? firstString(input.toolName),
    tool_input: toolInput,
    cwd: firstString(input.cwd),
  }
}

export type GuardableExtraction =
  | { kind: 'passthrough'; reason?: string }
  | { kind: 'guardable'; request: GuardRequest }
  | { kind: 'unreviewable'; reason: string }

/**
 * Convert a hook CLI payload to a guard request. Same fail-closed contract
 * as the claude/zcode adapters: unreadable parameters of a guarded tool are
 * `unreviewable`, surfaced as `ask` (the OpenCode TUI decides).
 */
export function toGuardRequest(input: OpencodeHookInput, workspace?: string): GuardableExtraction {
  const tool = GUARDED_PERMISSION_TYPES[input.tool_name ?? '']
  if (!tool) {
    return { kind: 'passthrough', reason: input.tool_name ? `untracked permission type ${input.tool_name}` : 'no tool name in payload' }
  }
  const params = input.tool_input ?? {}

  if (tool === 'bash') {
    const command = firstString(params.command)
    if (command === undefined) {
      return { kind: 'unreviewable', reason: '无法读取 bash 命令参数（metadata/patterns 均缺失），保守起见需要人工确认' }
    }
    return { kind: 'guardable', request: { tool, command, session: input.session_id, workspace } }
  }

  const filePath = firstString(params.file_path) ?? firstString(params.filePath) ?? firstString(params.path)
  if (filePath === undefined) {
    return { kind: 'unreviewable', reason: `无法读取 ${input.tool_name} 目标路径（metadata/patterns 均缺失），保守起见需要人工确认` }
  }
  const content = firstString(params.content)
  return {
    kind: 'guardable',
    request: content === undefined ? { tool, filePath, session: input.session_id, workspace } : { tool, filePath, content, session: input.session_id, workspace },
  }
}
