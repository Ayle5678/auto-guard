/**
 * Adapter mapping a ZCode PreToolUse hook stdin payload to the guard service
 * input. Dependency-free (structural types only) so it is unit-testable
 * without a running ZCode.
 *
 * The payload follows the Claude-compatible hook protocol (confirmed from the
 * ZCode client): snake_case fields plus camelCase fallbacks.
 */
import type { GuardRequest, Lang } from '@auto-guard/core'
import { zcMessage } from './messages.ts'

export interface ZcodeHookInput {
  session_id?: string
  transcript_path?: string
  hook_event_name?: string
  permission_mode?: string
  agent_type?: string
  /** Tool name; `toolName` accepted as a camelCase fallback. */
  tool_name?: string
  toolName?: string
  /** Tool arguments object; `toolInput` accepted as a camelCase fallback. */
  tool_input?: Record<string, unknown>
  toolInput?: Record<string, unknown>
  tool_use_id?: string
  cwd?: string
}

/** Guarded tools and their guard-side names, mirroring pi-auto-guard's adapter. */
export const GUARDED_TOOL_NAMES: Record<string, string> = {
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  // ApplyPatch is the alias ZCode reports for Write/Edit style edits.
  ApplyPatch: 'edit',
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function normalizeHookInput(raw: unknown): ZcodeHookInput {
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
    hook_event_name: firstString(input.hook_event_name),
    permission_mode: firstString(input.permission_mode),
    agent_type: firstString(input.agent_type),
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
 * Convert a hook payload to a guard request.
 *
 * - Tools outside the guarded set pass through untouched (same policy as
 *   pi-auto-guard ignoring grep/find/...).
 * - A guarded tool with readable parameters yields `{kind:'guardable'}`.
 * - A guarded tool whose parameters are missing or malformed yields
 *   `{kind:'unreviewable'}` — fail closed: the guard must not guess around
 *   payloads it cannot read, so callers surface these as `ask`.
 */
export function toGuardRequest(input: ZcodeHookInput, workspace?: string, lang: Lang = 'zh'): GuardableExtraction {
  const guardTool = GUARDED_TOOL_NAMES[input.tool_name ?? '']
  if (!guardTool) {
    return { kind: 'passthrough', reason: input.tool_name ? `untracked tool ${input.tool_name}` : 'no tool name in payload' }
  }
  const params = input.tool_input ?? {}

  if (guardTool === 'bash') {
    const command = firstString(params.command)
    if (command === undefined) {
      return { kind: 'unreviewable', reason: zcMessage(lang, 'unreviewableBash', { tool: input.tool_name ?? 'Bash' }) }
    }
    return {
      kind: 'guardable',
      request: {
        tool: guardTool,
        command,
        session: input.session_id,
        workspace,
      },
    }
  }

  const filePath = firstString(params.file_path) ?? firstString(params.filePath) ?? firstString(params.path)
  if (filePath === undefined) {
    return { kind: 'unreviewable', reason: zcMessage(lang, 'unreviewablePath', { tool: input.tool_name ?? '?' }) }
  }
  const content = firstString(params.content) ?? firstString(params.file_text)
  return {
    kind: 'guardable',
    request: content === undefined ? { tool: guardTool, filePath, session: input.session_id, workspace } : { tool: guardTool, filePath, content, session: input.session_id, workspace },
  }
}
