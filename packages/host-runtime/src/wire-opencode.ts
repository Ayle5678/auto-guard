/**
 * OpenCode exit wire (ADR-0015 / ADR-0016 serializer slot): unlike the
 * hook-form hosts (silence = allow), the OpenCode plugin side needs an
 * explicit verdict for every call it feeds the CLI:
 *   {"status":"allow"}              — plugin replies "once" (auto-approve)
 *   {"status":"deny","reason":"…"}  — plugin replies "reject" with the reason
 *   {"status":"ask","reason":"…"}   — plugin does not reply; native TUI asks
 * Anything unparseable is treated by the plugin as `ask` (host TUI decides).
 */
import type { WireSerializer } from './descriptor.ts'

export type GuardStatus = 'allow' | 'deny' | 'ask'

export interface GuardVerdict {
  status: GuardStatus
  reason?: string
}

/** Serialize a verdict to the exact stdout contract (always one JSON object). */
export function serializeVerdict(verdict: GuardVerdict): string {
  return JSON.stringify(verdict)
}

/** The `{status,reason}` wire bound into the descriptor slot shape. */
export const opencodeWire: WireSerializer = {
  serialize(outcome) {
    return serializeVerdict({ status: outcome.action, reason: outcome.reason })
  },
}

/** Parse and validate plugin-side; `undefined` when stdout is not a usable verdict. */
export function parseVerdict(stdout: string): GuardVerdict | undefined {
  try {
    const parsed = JSON.parse(stdout) as { status?: unknown; reason?: unknown }
    if (parsed !== null && typeof parsed === 'object' && (parsed.status === 'allow' || parsed.status === 'deny' || parsed.status === 'ask')) {
      return { status: parsed.status, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** How a guard status maps onto the OpenCode reply API (undefined = no reply, TUI asks). */
export function statusToReply(status: GuardStatus): 'once' | 'reject' | undefined {
  if (status === 'allow') return 'once'
  if (status === 'deny') return 'reject'
  return undefined
}

/** How a guard status maps onto the `permission.ask` output.status (undefined = leave untouched, TUI asks). */
export function statusToOutputStatus(status: GuardStatus): 'allow' | 'deny' | undefined {
  if (status === 'allow') return 'allow'
  if (status === 'deny') return 'deny'
  return undefined
}
