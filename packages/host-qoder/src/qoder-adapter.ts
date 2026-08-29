/**
 * Adapter mapping a Qoder PreToolUse hook stdin payload to the guard service
 * input. Dependency-free (structural types only) so it is unit-testable
 * without a running Qoder.
 *
 * The payload follows the Claude-compatible hook protocol (verified against
 * docs.qoder.com/extensions/hooks and the hook scripts Qoder itself ships in
 * resources/plugins/bundle-plugins/better-harness): snake_case fields with
 * camelCase fallbacks, `tool_input.command` for Bash.
 *
 * Qoder names its tools in two sets that both reach hooks — the Claude-style
 * short names (Bash/Read/Write/Edit) and long internal names
 * (run_in_terminal/read_file/create_file/search_replace); a Qoder-shipped
 * guardrail matcher also lists `apply_patch` (the Write/Edit alias, the same
 * role as zcode's ApplyPatch). All nine spellings map here.
 */
import type { GuardRequest } from '@auto-guard/core'

export interface QoderHookInput {
  session_id?: string
  transcript_path?: string
  hook_event_name?: string
  /** Tool name; `toolName` accepted as a camelCase fallback. */
  tool_name?: string
  toolName?: string
  /** Tool arguments object; `toolInput` accepted as a camelCase fallback. */
  tool_input?: Record<string, unknown>
  toolInput?: Record<string, unknown>
  tool_use_id?: string
  cwd?: string
}

/**
 * Guarded tools and their guard-side names. Short names first (the set the
 * official docs and Qoder's own hook examples use), then the long internal
 * names, then the apply_patch edit alias.
 */
export const GUARDED_TOOL_NAMES: Record<string, string> = {
  Bash: 'bash',
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  run_in_terminal: 'bash',
  read_file: 'read',
  create_file: 'write',
  search_replace: 'edit',
  apply_patch: 'edit',
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function normalizeHookInput(raw: unknown): QoderHookInput {
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
 * - Tools outside the guarded set pass through untouched (same policy as the
 *   claude/zcode adapters ignoring Grep/Glob/delete_file/...).
 * - A guarded tool with readable parameters yields `{kind:'guardable'}`.
 * - A guarded tool whose parameters are missing or malformed yields
 *   `{kind:'unreviewable'}` — fail closed: the guard must not guess around
 *   payloads it cannot read, so callers surface these as `ask`.
 */
export function toGuardRequest(input: QoderHookInput, workspace?: string): GuardableExtraction {
  const guardTool = GUARDED_TOOL_NAMES[input.tool_name ?? '']
  if (!guardTool) {
    return { kind: 'passthrough', reason: input.tool_name ? `untracked tool ${input.tool_name}` : 'no tool name in payload' }
  }
  const params = input.tool_input ?? {}

  if (guardTool === 'bash') {
    const command = firstString(params.command)
    if (command === undefined) {
      return { kind: 'unreviewable', reason: `无法读取 ${input.tool_name ?? 'Bash'} 命令参数（tool_input 解析失败），保守起见需要人工确认` }
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

  // The long internal names carry their path in path/filepath spellings; the
  // short ones follow Claude Code's file_path (snake) / filePath (camel).
  const filePath =
    firstString(params.file_path) ?? firstString(params.filePath) ?? firstString(params.filepath) ?? firstString(params.path)
  if (filePath === undefined) {
    return { kind: 'unreviewable', reason: `无法读取 ${input.tool_name ?? '?'} 目标路径（tool_input 解析失败），保守起见需要人工确认` }
  }
  // search_replace spells the replacement source new_string/newString;
  // create_file mirrors Claude Code's content/file_text.
  const content =
    firstString(params.content) ?? firstString(params.file_text) ?? firstString(params.new_string) ?? firstString(params.newString) ?? firstString(params.new_source)
  return {
    kind: 'guardable',
    request: content === undefined ? { tool: guardTool, filePath, session: input.session_id, workspace } : { tool: guardTool, filePath, content, session: input.session_id, workspace },
  }
}
