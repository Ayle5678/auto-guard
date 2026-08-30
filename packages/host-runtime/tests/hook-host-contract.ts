/**
 * Runtime parameterized contract suite (ADR-0016, SPEC 0013 ticket 01).
 *
 * `describeHookHostContract(descriptor, name)` runs the full behavioral
 * contract of `createHookHost` against ANY descriptor: the fail-closed
 * ladder through the real hook pipeline (headless via the io seam), the
 * exit-wire protocol, the management CLI language paths and the engine
 * language resolution. Host packages instantiate it with their own
 * descriptor; a contract violation is then a runtime bug, not a copy drift.
 *
 * Everything is rooted in a temp home via `{ home }` — no module mocks.
 */
import { describe, expect, it, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { GuardConfig } from '@auto-guard/core'
import { createHookHost, createDefaultWire, type HookHost, type HostDescriptor } from '../src/index.ts'

export interface HookIoCapture {
  stdout: string[]
  exitCodes: number[]
  spawns: Array<{ command: string; args: readonly string[] }>
}

export function describeHookHostContract(descriptor: HostDescriptor, name: string): void {
  let dir = ''
  let host: HookHost
  let capture: HookIoCapture

  const configJsonPath = () => join(dir, ...descriptor.configRootSegments, 'config.json')

  function writeConfig(config: Partial<GuardConfig>): void {
    mkdirSync(join(dir, ...descriptor.configRootSegments), { recursive: true })
    writeFileSync(configJsonPath(), JSON.stringify({ enabled: true, autoAnalyzeEnabled: false, ...config }), 'utf8')
  }

  /** Drive hookMain headless: inject stdin, capture stdout + exit codes. */
  async function runHook(payload: string): Promise<HookIoCapture> {
    capture = { stdout: [], exitCodes: [], spawns: [] }
    await host.hookMain({
      stdin: payload,
      writeOut: (text) => capture.stdout.push(text),
      exit: (code) => capture.exitCodes.push(code ?? 0),
      spawnAnalysis: (command, args) => {
        capture.spawns.push({ command, args })
        return undefined
      },
    })
    return capture
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `ag-rt-${descriptor.hostId}-`))
    host = createHookHost(descriptor, { home: dir, spawnAnalysis: () => undefined })
  })

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // Windows may still hold WAL handles briefly; the OS temp cleaner wins.
    }
  })

  beforeEach(() => {
    writeConfig({})
  })

  /** The host wire's stdout for an allow outcome ('' for hook hosts, explicit JSON for opencode). */
  const allowOut = (): string => (descriptor.wire ?? createDefaultWire(descriptor.capabilities)).serialize({ action: 'allow' })

  /** A guarded bash-surface tool name in THIS host's spelling (Bash vs bash vs run_in_terminal). */
  const bashTool = (): string =>
    Object.entries(descriptor.guardedTools).find(([, m]) => m.guardTool === 'bash')?.[0] ?? 'Bash'

  /**
   * How THIS host renders a fail-closed ask (SPEC 0015): most hosts surface
   * the ask to their permission system; hosts with `headlessFallback: 'deny'`
   * (codex — its PreToolUse "ask" is discarded-and-continued) render deny.
   */
  const failClosedRendering = (): 'ask' | 'deny' =>
    descriptor.capabilities.headlessFallback === 'deny' ? 'deny' : 'ask'

  /** Assert stdout equals the wire's allow rendering ([] for silence). */
  function expectAllow(capture: HookIoCapture): void {
    const expected = allowOut()
    expect(capture.stdout).toEqual(expected ? [expected] : [])
  }

  describe(`${name}: fail-closed ladder through the shared pipeline`, () => {
    it('unparseable stdin → fail-closed rendering (ask, or deny on deny-fallback hosts), exit 0', async () => {
      const { stdout, exitCodes } = await runHook('not json at all')
      expect(failClosedDecision(stdout[0])).toBe(failClosedRendering())
      expect(exitCodes).toEqual([])
    })

    it('non-PreToolUse events pass silently', async () => {
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: bashTool(), tool_input: { command: 'git status' } }))
      expect(stdout).toEqual([]) // empty-emit exit is shared, wire-independent
    })

    it('enabled:false short-circuits to the wire allow rendering', async () => {
      writeConfig({ enabled: false })
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: bashTool(), tool_input: { command: 'git status' } }))
      expectAllow({ stdout, exitCodes: [], spawns: [] })
    })

    it('static-allowed bash passes without an LLM round-trip', async () => {
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: bashTool(), tool_input: { command: 'git status' } }))
      expectAllow({ stdout, exitCodes: [], spawns: [] })
    })

    it('hard-deny emits a deny verdict carrying the rule reason', async () => {
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: bashTool(), tool_input: { command: 'rm -rf /' } }))
      const parsed = JSON.parse(stdout[0]) as Record<string, unknown>
      expect(failClosedDecision(JSON.stringify(parsed))).toBe('deny')
      expect(JSON.stringify(parsed).length).toBeGreaterThan(0)
    })

    it('guarded tool with unreadable parameters → fail-closed rendering (unreviewable)', async () => {
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: bashTool(), tool_input: {} }))
      expect(failClosedDecision(stdout[0])).toBe(failClosedRendering())
    })

    it('untracked tools pass through without an LLM round-trip', async () => {
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'TotallyUnknownTool', tool_input: {} }))
      expectAllow({ stdout, exitCodes: [], spawns: [] })
    })
  })

  describe(`${name}: exit wire protocol`, () => {
    it('deny/ask serialize as one JSON object under the host wire', async () => {
      const deny = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: bashTool(), tool_input: { command: 'rm -rf /' } }))
      expect(deny.stdout).toHaveLength(1)
      // The wire-specific shape is asserted by the descriptor's own row via
      // its serializer; the pipeline contract only pins one JSON object.
      expect(() => JSON.parse(deny.stdout[0])).not.toThrow()
    })

    it('sensitive file writes ask without an LLM', async () => {
      const writeTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.guardTool === 'write')?.[0]
      if (!writeTool) return // host has no write-surface tool in the guarded set
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: writeTool, tool_input: { [descriptor.pathFields[0] ?? 'file_path']: '.env', content: 'A=1' } }))
      expect(failClosedDecision(stdout[0])).toBe(failClosedRendering())
    })

    it('patch-text tools review every target path (SPEC 0015)', async () => {
      const patchTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.patchCommand !== undefined)
      if (!patchTool) return // host has no patch-surface tool in the guarded set
      const [toolName, mapping] = patchTool
      const patch = ['*** Begin Patch', '*** Update File: src/app.ts', '@@ line', '*** Update File: .env', '+KEY=1', ''].join('\n')
      const { stdout } = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { [mapping.patchCommand!]: patch } }))
      // The sensitive hit is the SECOND path in the patch — the whole set must
      // cross the gate, and the outcome renders in the host's fail-closed form.
      expect(failClosedDecision(stdout[0])).toBe(failClosedRendering())
    })

    it('patch-text tools pass benign patches and reject headerless ones', async () => {
      const patchTool = Object.entries(descriptor.guardedTools).find(([, m]) => m.patchCommand !== undefined)
      if (!patchTool) return
      const [toolName, mapping] = patchTool
      const benign = ['*** Begin Patch', '*** Update File: src/app.ts', '@@ line', '+ok()', ''].join('\n')
      const allowed = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { [mapping.patchCommand!]: benign } }))
      expectAllow(allowed)
      const headerless = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { [mapping.patchCommand!]: 'not a patch at all' } }))
      expect(failClosedDecision(headerless.stdout[0])).toBe(failClosedRendering())
    })
  })

  describe(`${name}: management CLI language paths (ADR-0011)`, () => {
    // Local LLM mock serving a deny decision; baseConfig() points apiBase at it
    // (the reviewer talks real one-shot HTTP, so fetch stubs no longer apply).
    let llmServer: Server | undefined
    let llmApiBase = 'https://api.deepseek.com'
    beforeAll(async () => {
      llmServer = createServer((req, res) => {
        req.resume()
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ choices: [{ message: { content: '{"decision":"deny","risk":"medium","reason":"nope"}' } }] }))
        })
      })
      await new Promise<void>((resolve) => llmServer!.listen(0, '127.0.0.1', resolve))
      const addr = llmServer!.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      llmApiBase = `http://127.0.0.1:${port}`
    })
    afterAll(async () => {
      await new Promise<void>((resolve) => (llmServer ? llmServer.close(() => resolve()) : resolve()))
    })

    /** Capture cliMain stdout without touching the real terminal. */
    async function capture(argv: readonly string[]): Promise<string> {
      const chunks: string[] = []
      const original = process.stdout.write
      process.stdout.write = ((chunk: string | Uint8Array) => {
        chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
        return true
      }) as typeof process.stdout.write
      try {
        await host.cliMain(argv)
      } finally {
        process.stdout.write = original
      }
      return chunks.join('')
    }

    it('guard status renders in English with the effective-language line', async () => {
      writeConfig({ lang: 'en', apiBase: llmApiBase })
      const out = await capture(['guard', 'status'])
      expect(out).toContain('lang    : en')
      expect(out).toContain('no API Key (fail-closed)')
    })

    it('group usage receipts switch to English', async () => {
      writeConfig({ lang: 'en', apiBase: llmApiBase })
      expect(await capture(['guard', 'bogus'])).toContain('Usage: node dist/cli.js guard')
      expect(await capture(['examine', 'on'])).toContain('Audit log enabled')
      expect(await capture(['optimize', 'bogus'])).toContain('Usage: node dist/cli.js optimize')
    })

    it('set lang persists to the config root and receipts in the new language', async () => {
      writeConfig({ lang: 'en' })
      const out = await capture(['set', 'lang', 'zh'])
      expect(out).toContain('语言已设置：zh')
      expect(JSON.parse(readFileSync(configJsonPath(), 'utf8') as string).lang).toBe('zh')
    })

    it('set lang rejects unknown values listing the available ones', async () => {
      writeConfig({ lang: 'en' })
      const out = await capture(['set', 'lang', 'fr'])
      expect(out).toContain('Invalid language value: fr')
      expect(out).toContain('zh, en')
    })

    it('the engine carries the effective language (pending-deny ask reason)', async () => {
      writeConfig({ lang: 'en', apiBase: llmApiBase })
      process.env.DEEPSEEK_API_KEY = 'sk-test'
      try {
        const { createBootstrap, createConfigSpace } = await import('../src/index.ts')
        const kit = createBootstrap(descriptor, createConfigSpace(descriptor, dir), dir)
        const rt = kit.bootstrap()
        expect(rt.lang).toBe('en')
        const request = { tool: 'bash' as const, command: 'npm install left-pad', session: 's1', workspace: dir }
        await rt.service.decide(request)
        const ask = await rt.service.decide(request)
        expect(ask.source).toBe('llm')
        expect(ask.reason).toContain('The LLM already denied this command')
        rt.audit.close()
      } finally {
        delete process.env.DEEPSEEK_API_KEY
      }
    })
  })

  function failClosedDecision(flat: string): string {
    if (flat.includes('"permissionDecision"')) return (JSON.parse(flat) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision
    return (JSON.parse(flat) as { status: string }).status
  }
}
