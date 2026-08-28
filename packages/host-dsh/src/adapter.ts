/**
 * Pure adapter helpers mapping DSH {@link ToolExecution}-shaped objects to the
 * guard service input. Kept dependency-free (type-only) so they are unit
 * testable without a running DSH.
 */
import type { GuardRequest } from '@auto-guard/core'

/** The subset of DSH's ToolExecution the plugin reads. */
export interface ExecutionLike {
  name: string
  arguments: unknown
  signal: AbortSignal
  agent?: {
    session: {
      id?: string
      header: { cwd?: string; workspace?: string }
      events?: readonly unknown[]
    }
  }
}

function readArg(args: unknown, key: string): string | undefined {
  if (typeof args === 'object' && args !== null && key in args) {
    const raw: unknown = (args as Record<string, unknown>)[key]
    if (typeof raw === 'string') return raw
  }
  return undefined
}

/** Convert an execution to a guard request, or undefined for out-of-scope tools. */
export function toGuardRequest(exec: ExecutionLike): GuardRequest | undefined {
  const session = exec.agent?.session.id
  const workspace = exec.agent?.session.header.cwd ?? exec.agent?.session.header.workspace

  if (exec.name === 'bash' || exec.name === 'pwsh') {
    const command = readArg(exec.arguments, 'command')
    if (command === undefined) return undefined
    return { tool: exec.name, command, session, workspace, signal: exec.signal, events: exec.agent?.session.events }
  }

  if (exec.name === 'write' || exec.name === 'edit' || exec.name === 'read') {
    const filePath = readArg(exec.arguments, 'file_path') ?? readArg(exec.arguments, 'path')
    if (filePath === undefined) return undefined
    const content = readArg(exec.arguments, 'content')
    return content === undefined
      ? { tool: exec.name, filePath, session, workspace, signal: exec.signal }
      : { tool: exec.name, filePath, content, session, workspace, signal: exec.signal }
  }

  return undefined
}
