/**
 * Pure adapter mapping a normalized Pi tool call to the guard service input.
 * Kept dependency-free (structural types only) so it is unit testable without a
 * running Pi.
 */
import type { GuardRequest } from '@auto-guard/core'

/** The subset of a Pi tool call the guard reads, already extracted by index.ts. */
export interface PiToolCallLike {
  tool: string
  command?: string
  filePath?: string
  content?: string
  session?: string
  workspace?: string
  signal?: AbortSignal
  events?: readonly unknown[]
}

/** Guardable Pi tools. `pwsh` is reserved for future custom-tool support. */
export const GUARDABLE_TOOLS = new Set(['bash', 'pwsh', 'write', 'edit', 'read'])

/**
 * Convert an extracted tool call to a guard request, or undefined for
 * out-of-scope tools (grep, find, ls, ...).
 */
export function toGuardRequest(exec: PiToolCallLike): GuardRequest | undefined {
  if (!GUARDABLE_TOOLS.has(exec.tool)) return undefined

  const session = exec.session
  const workspace = exec.workspace

  if (exec.tool === 'bash' || exec.tool === 'pwsh') {
    if (exec.command === undefined) return undefined
    return { tool: exec.tool, command: exec.command, session, workspace, signal: exec.signal, events: exec.events }
  }

  if (exec.tool === 'write' || exec.tool === 'edit' || exec.tool === 'read') {
    if (exec.filePath === undefined) return undefined
    return exec.content === undefined
      ? { tool: exec.tool, filePath: exec.filePath, session, workspace, signal: exec.signal }
      : { tool: exec.tool, filePath: exec.filePath, content: exec.content, session, workspace, signal: exec.signal }
  }

  return undefined
}
