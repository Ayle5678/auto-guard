/**
 * OpenCode plugin entry (ADR-0015, revised at implementation time).
 *
 * Dispatch reality on OpenCode 1.18.x (verified against the compiled host
 * binary, see research/opencode-plugin-api.md): the `permission.ask` plugin
 * hook is typed upstream but NEVER dispatched. The path that actually fires
 * is the bus event `permission.asked` — delivered to the plugin `event`
 * hook — plus the client reply API. So the guard works through:
 *
 *   1. installer writes permission rules (bash/edit/read → `"*": "ask"`),
 *      so guarded calls surface as `permission.asked` events;
 *   2. this plugin watches those events, spawns `node dist/hook-cli.js`
 *      (full decision pipeline, never inside bun), and replies:
 *        allow → reply "once"   (auto-approved, user sees nothing)
 *        deny  → reply "reject" with the guard reason as feedback
 *        ask   → no reply       (OpenCode's native TUI: once/always/reject)
 *   3. the `permission.ask` hook below mirrors the same mapping for hosts
 *      that start dispatching it (forward compatibility, no-op today).
 *
 * Never throw: an exception inside a plugin surfaces as a tool error, not a
 * permission decision. Any failure leaves the request unanswered, which
 * lands on the native TUI — the human gate stays closed.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { payloadFromAsked, payloadFromSdkPermission } from './opencode-adapter.ts'
import { parseVerdict, statusToOutputStatus, statusToReply, type GuardVerdict } from './hook-output.ts'
import type { AutoGuardHooks, BusEvent, OpencodePluginInput, PermissionAskedProperties } from './opencode-plugin-types.ts'

/** Injected seam so the wiring is unit-testable without bun or a real opencode. */
export interface GuardSpawn {
  (payload: unknown): Promise<GuardVerdict | undefined>
}

export interface PermissionReply {
  (requestID: string, reply: 'once' | 'reject', message?: string): Promise<void>
}

export interface EventGuardDeps {
  spawnHook: GuardSpawn
  reply: PermissionReply
}

/** Bounded seen-set: bus events replay on reconnect; a request is answered at most once. */
export class SeenRequests {
  private readonly seen = new Map<string, true>()
  constructor(private readonly cap = 512) {}
  mark(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.set(id, true)
    if (this.seen.size > this.cap) {
      this.seen.delete(this.seen.keys().next().value as string)
    }
    return true
  }
}

/**
 * Handle one `permission.asked` event. Pure orchestration over injected
 * deps: map → spawn → reply. All failures degrade to "no reply" (TUI).
 */
export async function handlePermissionAsked(
  props: PermissionAskedProperties,
  worktree: string,
  deps: EventGuardDeps,
  seen: SeenRequests,
): Promise<void> {
  if (!seen.mark(props.id)) return
  const payload = payloadFromAsked(props, worktree)
  if (!payload) return // not a guarded permission type; host flow proceeds
  let verdict: GuardVerdict | undefined
  try {
    verdict = await deps.spawnHook(payload)
  } catch {
    return // guard blew up unexpectedly → no reply, native TUI decides
  }
  if (!verdict) return // guard unavailable → native TUI decides
  const reply = statusToReply(verdict.status)
  if (reply) await deps.reply(props.id, reply, verdict.status === 'deny' ? verdict.reason : undefined)
}

/** Real spawn: `node <dist>/hook-cli.js` with the payload on stdin (shell never involved). */
export function spawnHookCli(payload: unknown): Promise<GuardVerdict | undefined> {
  const hookCli = fileURLToPath(new URL('./hook-cli.js', import.meta.url)).replaceAll('\\', '/')
  const executable = process.env.AUTO_GUARD_NODE || 'node'
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(executable, [hookCli], { stdio: ['pipe', 'pipe', 'ignore'], shell: false })
    } catch {
      resolve(undefined)
      return
    }
    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => resolve(undefined))
    child.on('close', () => resolve(parseVerdict(stdout)))
    child.stdin.on('error', () => {}) // EPIPE when the CLI dies early; close handler resolves.
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

/** OpenCode plugin function — named export, no default (documented plugin module shape). */
export const AutoGuard = async (input: OpencodePluginInput): Promise<AutoGuardHooks> => {
  const seen = new SeenRequests()
  const deps: EventGuardDeps = {
    spawnHook: spawnHookCli,
    reply: async (requestID, reply, message) => {
      await input.client.permission.reply({ requestID, reply, message })
    },
  }
  return {
    event: async ({ event }: { event: BusEvent }) => {
      try {
        if (event.type !== 'permission.asked') return
        const props = event.properties as PermissionAskedProperties | undefined
        if (!props || typeof props.id !== 'string' || typeof props.sessionID !== 'string') return
        // Awaited so failures land in this catch; the host never waits on us
        // beyond its own permission timeout.
        await handlePermissionAsked(props, input.worktree, deps, seen)
      } catch {
        // Never throw out of a plugin hook (tool error ≠ permission decision).
      }
    },
    'permission.ask': async (permission, output) => {
      try {
        const payload = payloadFromSdkPermission(permission, input.worktree)
        if (!payload) return
        const verdict = await deps.spawnHook(payload)
        if (!verdict) return // leave status = "ask" → TUI
        const status = statusToOutputStatus(verdict.status)
        if (status) output.status = status
      } catch {
        // Leave status untouched; the native TUI decides.
      }
    },
  }
}
