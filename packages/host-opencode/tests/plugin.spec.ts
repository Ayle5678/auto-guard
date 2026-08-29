/**
 * Plugin wiring tests (ticket 03): status three-way mapping, dedup,
 * never-throw, fail-to-TUI. All against injected spawn/reply seams — no bun,
 * no real opencode.
 */
import { describe, expect, it, vi } from 'vitest'
import { AutoGuard, SeenRequests, handlePermissionAsked } from '../src/plugin.ts'
import type { EventGuardDeps } from '../src/plugin.ts'
import type { PermissionAskedProperties } from '../src/opencode-plugin-types.ts'

const WT = 'D:/work/demo'

function asked(overrides: Partial<PermissionAskedProperties> = {}): PermissionAskedProperties {
  return { id: 'perm_1', sessionID: 'ses_1', permission: 'bash', patterns: [], metadata: { command: 'git status' }, ...overrides }
}

function deps(verdict: { status: 'allow' | 'deny' | 'ask'; reason?: string } | undefined | Error): { d: EventGuardDeps; spawn: ReturnType<typeof vi.fn>; reply: ReturnType<typeof vi.fn> } {
  const spawn = vi.fn(async () => (verdict instanceof Error ? Promise.reject(verdict) : verdict))
  const reply = vi.fn(async () => {})
  return { d: { spawnHook: spawn, reply }, spawn, reply }
}

describe('handlePermissionAsked', () => {
  it('allow → replies once without a message', async () => {
    const { d, reply } = deps({ status: 'allow' })
    await handlePermissionAsked(asked(), WT, d, new SeenRequests())
    expect(reply).toHaveBeenCalledWith('perm_1', 'once', undefined)
  })

  it('deny → replies reject carrying the guard reason as feedback', async () => {
    const { d, reply } = deps({ status: 'deny', reason: '危险命令' })
    await handlePermissionAsked(asked(), WT, d, new SeenRequests())
    expect(reply).toHaveBeenCalledWith('perm_1', 'reject', '危险命令')
  })

  it('ask → no reply; the native TUI (once/always/reject) decides', async () => {
    const { d, reply } = deps({ status: 'ask', reason: '需要确认' })
    await handlePermissionAsked(asked(), WT, d, new SeenRequests())
    expect(reply).not.toHaveBeenCalled()
  })

  it('spawn failure (guard unavailable) → no reply, falls to TUI', async () => {
    const { d, reply } = deps(undefined)
    await handlePermissionAsked(asked(), WT, d, new SeenRequests())
    expect(reply).not.toHaveBeenCalled()
  })

  it('unguarded permission types never spawn', async () => {
    const { d, spawn } = deps({ status: 'deny' })
    await handlePermissionAsked(asked({ permission: 'webfetch' }), WT, d, new SeenRequests())
    expect(spawn).not.toHaveBeenCalled()
  })

  it('answers a request at most once (bus events replay on reconnect)', async () => {
    const { d, spawn } = deps({ status: 'allow' })
    const seen = new SeenRequests()
    await handlePermissionAsked(asked(), WT, d, seen)
    await handlePermissionAsked(asked(), WT, d, seen)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('spawn rejection never throws out of the handler', async () => {
    const { d, reply } = deps(new Error('boom'))
    await expect(handlePermissionAsked(asked(), WT, d, new SeenRequests())).resolves.toBeUndefined()
    expect(reply).not.toHaveBeenCalled()
  })
})

describe('SeenRequests', () => {
  it('evicts oldest beyond the cap', () => {
    const seen = new SeenRequests(2)
    expect(seen.mark('a')).toBe(true)
    expect(seen.mark('b')).toBe(true)
    expect(seen.mark('c')).toBe(true)
    expect(seen.mark('a')).toBe(true) // evicted by c, so a is fresh again
  })
})

describe('AutoGuard plugin wiring', () => {
  const makeInput = () => {
    const reply = vi.fn(async () => {})
    return {
      input: {
        client: { permission: { reply } },
        project: {},
        directory: 'D:/work/demo',
        worktree: WT,
        serverUrl: new URL('http://127.0.0.1:1'),
        $: {},
      },
      reply,
    }
  }

  it('routes permission.asked events through the injected pipeline', async () => {
    const { input, reply } = makeInput()
    const hooks = await AutoGuard(input)
    expect(hooks.event).toBeTypeOf('function')
    expect(hooks['permission.ask']).toBeTypeOf('function')
    // The real plugin wires spawnHookCli; exercising the full spawn needs a
    // built dist. Here we only pin the hook surface — the mapping logic is
    // covered above through handlePermissionAsked.
    void reply
  })

  it('event hook ignores non-permission events and never throws', async () => {
    const { input } = makeInput()
    const hooks = await AutoGuard(input)
    await expect(hooks.event!({ event: { id: 'e1', type: 'message.updated', properties: {} } })).resolves.toBeUndefined()
    // Malformed permission.asked properties (no id) are dropped, not thrown.
    await expect(hooks.event!({ event: { id: 'e2', type: 'permission.asked', properties: { bad: true } } })).resolves.toBeUndefined()
  })

  it('permission.ask hook maps allow/deny onto output.status and leaves ask untouched (forward compat)', async () => {
    const { input } = makeInput()
    const hooks = await AutoGuard(input)
    // Guard unavailable (spawn fails against missing dist in unit context):
    // status stays "ask" — the fail-to-TUI contract.
    const output = { status: 'ask' as 'ask' | 'deny' | 'allow' }
    await expect(hooks['permission.ask']!({ id: 'p', type: 'bash', sessionID: 's', messageID: 'm', title: 't', metadata: { command: 'ls' } }, output)).resolves.toBeUndefined()
    expect(output.status).toBe('ask')
  })
})
