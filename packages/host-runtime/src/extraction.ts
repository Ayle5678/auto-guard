/**
 * Payload → GuardRequest extraction, parameterized by the host descriptor
 * (ADR-0016). This was the per-host adapter's `normalizeHookInput` +
 * `toGuardRequest`, byte-for-byte; the host differences (tool name tables,
 * field-spelling chains, the qoder `delete_file` rm synthesis) are now
 * descriptor data.
 *
 * Fail-closed contract: a guarded tool with unreadable parameters is
 * `unreviewable` — callers surface it as `ask`, never a silent pass.
 */
import type { GuardRequest, Lang } from '@auto-guard/core'
import type { HostDescriptor, ToolMapping } from './descriptor.ts'
import type { HostMessage } from './messages.ts'

/** Normalized hook stdin payload (the Claude-compatible union every host speaks). */
export interface HookInput {
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

export type GuardableExtraction =
  | { kind: 'passthrough'; reason?: string }
  | { kind: 'guardable'; request: GuardRequest }
  | { kind: 'unreviewable'; reason: string }

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function firstOf(params: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const hit = firstString(params[key])
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Encode a path as one safe double-quoted shell word (SPEC 0012): backslashes first so a trailing `C:\dir\` cannot escape the closing quote, then double quotes. */
export function synthesizeShellCommand(command: string, path: string): string {
  return `${command} "${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Extract the target paths of an apply_patch V4A patch text (SPEC 0015).
 * Every `*** Add File:` / `*** Update File:` / `*** Delete File:` header and
 * `*** Move to:` rename target yields one path; order of first appearance is
 * kept and duplicates are dropped. Content lines never match (they do not
 * start with the `*** ` header marker).
 */
export function parsePatchPaths(patchText: string): string[] {
  const paths: string[] = []
  for (const match of patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gim)) {
    const path = match[1].trim()
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

export interface HostExtraction {
  normalizeHookInput(raw: unknown): HookInput
  toGuardRequest(input: HookInput, workspace?: string, lang?: Lang): GuardableExtraction
  /** The descriptor's guarded-tool table, flattened to guard-side names for tests. */
  guardedToolNames: Record<string, string>
}

export function createExtraction(descriptor: HostDescriptor, message: HostMessage): HostExtraction {
  const toolNames: Record<string, string> = Object.fromEntries(
    Object.entries(descriptor.guardedTools).map(([name, mapping]) => [name, mapping.guardTool]),
  )

  function normalizeHookInput(raw: unknown): HookInput {
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

  function toGuardRequest(input: HookInput, workspace?: string, lang: Lang = 'zh'): GuardableExtraction {
    const mapping: ToolMapping | undefined = descriptor.guardedTools[input.tool_name ?? '']
    if (!mapping) {
      return { kind: 'passthrough', reason: input.tool_name ? `untracked tool ${input.tool_name}` : 'no tool name in payload' }
    }
    const params = input.tool_input ?? {}

    // SPEC 0012 synthesis: the payload carries a path, not a command. Same
    // defensive path chain as the file tools; no readable path →
    // unreviewable (fail-closed ask, never a pass).
    if (mapping.synthesizeCommand !== undefined) {
      const path = firstOf(params, descriptor.pathFields)
      if (path === undefined) {
        return { kind: 'unreviewable', reason: message(lang, 'unreviewablePath', { tool: input.tool_name ?? '?' }) }
      }
      return {
        kind: 'guardable',
        request: {
          tool: 'bash',
          command: synthesizeShellCommand(mapping.synthesizeCommand, path),
          session: input.session_id,
          workspace,
        },
      }
    }

    // SPEC 0015 patch extraction: the payload carries an apply_patch patch
    // text, not fielded paths. Missing text or a headerless patch is
    // unreviewable (fail-closed); a parsed patch reviews every target path.
    if (mapping.patchCommand !== undefined) {
      const patchText = firstOf(params, [mapping.patchCommand])
      if (patchText === undefined) {
        return { kind: 'unreviewable', reason: message(lang, 'unreviewablePath', { tool: input.tool_name ?? '?' }) }
      }
      const paths = parsePatchPaths(patchText)
      if (paths.length === 0) {
        return { kind: 'unreviewable', reason: message(lang, 'unreviewablePath', { tool: input.tool_name ?? '?' }) }
      }
      return {
        kind: 'guardable',
        request: {
          tool: mapping.guardTool,
          filePath: paths[0],
          paths,
          session: input.session_id,
          workspace,
        },
      }
    }

    if (mapping.guardTool === 'bash') {
      const command = firstString(params.command)
      if (command === undefined) {
        return { kind: 'unreviewable', reason: message(lang, 'unreviewableBash', { tool: input.tool_name ?? 'Bash' }) }
      }
      return {
        kind: 'guardable',
        request: {
          tool: mapping.guardTool,
          command,
          session: input.session_id,
          workspace,
        },
      }
    }

    const filePath = firstOf(params, descriptor.pathFields)
    if (filePath === undefined) {
      return { kind: 'unreviewable', reason: message(lang, 'unreviewablePath', { tool: input.tool_name ?? '?' }) }
    }
    const content = firstOf(params, descriptor.contentFields)
    return {
      kind: 'guardable',
      request:
        content === undefined
          ? { tool: mapping.guardTool, filePath, session: input.session_id, workspace }
          : { tool: mapping.guardTool, filePath, content, session: input.session_id, workspace },
    }
  }

  return { normalizeHookInput, toGuardRequest, guardedToolNames: toolNames }
}
