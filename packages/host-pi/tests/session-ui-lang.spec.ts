/**
 * Pi session-UI language surface (ticket 02): under an English config the
 * four-option ask dialog renders English labels, the deny-reason branch
 * triggers on the two deny states, choices resolve by value (either
 * language's label), and the session-memory semantics are unchanged.
 * The config root is mocked into a temp dir; the LLM is a local HTTP mock
 * (the reviewer talks real one-shot HTTP, so fetch stubs no longer apply).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { GuardConfig } from '@auto-guard/core'

// One dir per file: each extension() call opens a SQLite audit store that is
// never closed inside the extension, so per-test cleanup would hit EPERM on
// Windows. Best-effort cleanup at the end; the OS temp dir handles the rest.
const dir = mkdtempSync(join(tmpdir(), 'ag-pi-ui-'))

// Local LLM mock serving an ask decision; baseConfig() points apiBase at it.
let llmServer: Server | undefined
let llmApiBase = 'https://api.deepseek.com'
beforeAll(async () => {
  llmServer = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: '{"decision":"ask","risk":"medium","reason":"uncertain"}' } }] }))
    })
  })
  await new Promise<void>((resolve) => llmServer!.listen(0, '127.0.0.1', resolve))
  const addr = llmServer!.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  llmApiBase = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => (llmServer ? llmServer.close(() => resolve()) : resolve()))
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Handles may still be open on Windows; the temp dir sweeper will take it.
  }
})

// The Pi SDK ships only as ambient types here (pi-sdk.d.ts); the runtime
// module is provided by Pi itself. Stub the few values src/index.ts imports.
vi.mock('@earendil-works/pi-coding-agent', () => ({
  createLocalBashOperations: () => {
    throw new Error('not needed in tests')
  },
  isToolCallEventType: (tool: string, event: { toolName: string }) => event.toolName === tool,
}))
vi.mock('../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.ts')>()
  return {
    ...actual,
    get AUTO_GUARD_DIR() {
      return dir
    },
    get DEFAULT_CONFIG_PATH() {
      return join(dir, 'config.json')
    },
    defaultConfig: () => baseConfig(),
    loadConfig: () => baseConfig(),
    saveConfig: () => {},
  }
})

function baseConfig(): GuardConfig {
  return {
    enabled: true,
    lang: 'en',
    rulesPath: join(dir, 'rules.json'),
    defaultRulesPath: join(dir, 'defaults.json'),
    cachePath: join(dir, 'cache.json'),
    apiBase: llmApiBase,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: 'sk-test-key',
    model: 'm',
    fallbackModel: 'm',
    timeoutMs: 3000,
    lowRiskTtlDays: 30,
    mediumRiskTtlDays: 7,
    onTimeout: 'deny',
    headlessMode: 'deny',
    notifyCacheHit: true,
    notifyLlmDecision: false,
    notifyAllow: 'page',
    notifyDeny: 'context',
    notifyAsk: 'context',
    fileTrackerDefault: 'ask',
    fileTrackerWindowSec: 5,
    sessionCacheSize: 256,
    alwaysReviewCacheTtlMinutes: 30,
    examineEnabled: false,
    auditDbPath: join(dir, 'audit.db'),
    historyEnabled: false,
    autoAnalyzeEnabled: false,
    historyDays: 60,
    historyMinTotal: 4,
    historyMinLlm: 1,
    learnedCacheableMinTotal: 8,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    templateCachePath: join(dir, 'template-cache.json'),
    learnedRulesPath: join(dir, 'learned-rules.json'),
    learnedBackupPath: join(dir, 'learned-rules.backup.json'),
    analyzeStatePath: join(dir, 'analyze-state.json'),
  }
}

interface Captured {
  selectTitle?: string
  selectOptions?: string[]
  inputTitles: string[]
  notifies: string[]
}

function makePi() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>()
  const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>()
  const sent: unknown[] = []
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(event, handler),
    registerCommand: (name: string, def: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, def),
    sendMessage: (message: unknown) => sent.push(message),
  }
  return { pi: pi as unknown as ExtensionAPI, handlers, commands, sent }
}

function makeCtx(captured: Captured, selectAnswer: () => Promise<string | undefined>) {
  return {
    hasUI: true,
    cwd: dir,
    signal: undefined,
    sessionManager: { getSessionId: () => 'sess-1' },
    ui: {
      select: async (title: string, options: string[]) => {
        captured.selectTitle = title
        captured.selectOptions = options
        return selectAnswer()
      },
      input: async (title: string) => {
        captured.inputTitles.push(title)
        return 'user reason'
      },
      confirm: async () => false,
      notify: (message: string) => captured.notifies.push(message),
    },
  }
}

function bashEvent(command: string) {
  return { toolName: 'bash', input: { command } }
}

describe('pi ask dialog: English labels + value matching', () => {
  it('renders the four English labels for an LLM ask', async () => {
    const { pi, handlers } = makePi()
    const { default: extension } = await import('../src/index.ts')
    extension(pi)
    const captured: Captured = { inputTitles: [], notifies: [] }
    const ctx = makeCtx(captured, async () => 'Allow (just this once)')

    const outcome = await handlers.get('tool_call')!(bashEvent('python3 train.py --epochs 3'), ctx)

    expect(captured.selectTitle).toBe('The LLM is unsure — how should this proceed?')
    expect(captured.selectOptions).toEqual([
      'Allow (just this once)',
      'Allow for the rest of this session',
      'Deny (reason optional)',
      'Deny for the rest of this session (reason optional)',
    ])
    // allow-once: not blocked, no deny-reason input asked.
    expect(outcome).toBeUndefined()
    expect(captured.inputTitles).toHaveLength(0)
  })

  it('asks for a deny reason on the deny states and passes it through', async () => {
    const { pi, handlers } = makePi()
    const { default: extension } = await import('../src/index.ts')
    extension(pi)
    const captured: Captured = { inputTitles: [], notifies: [] }
    const ctx = makeCtx(captured, async () => 'Deny (reason optional)')

    const outcome = (await handlers.get('tool_call')!(bashEvent('python3 train.py --epochs 3'), ctx)) as { block: boolean; reason?: string } | undefined

    expect(captured.inputTitles).toEqual(['Deny reason'])
    expect(outcome).toEqual({ block: true, reason: 'user reason' })
  })

  it('session-wide deny is remembered: the retry blocks from the session cache', async () => {
    const { pi, handlers } = makePi()
    const { default: extension } = await import('../src/index.ts')
    extension(pi)
    const captured: Captured = { inputTitles: [], notifies: [] }
    const ctx = makeCtx(captured, async () => 'Deny for the rest of this session (reason optional)')

    const first = (await handlers.get('tool_call')!(bashEvent('python3 train.py --epochs 3'), ctx)) as { block: boolean; reason?: string } | undefined
    expect(first).toEqual({ block: true, reason: 'user reason' })

    // Second identical call in the same session: no dialog, denied from the session cache.
    const secondCaptured: Captured = { inputTitles: [], notifies: [] }
    const secondCtx = makeCtx(secondCaptured, async () => {
      throw new Error('select must not be called again')
    })
    const second = (await handlers.get('tool_call')!(bashEvent('python3 train.py --epochs 3'), secondCtx)) as { block: boolean; reason?: string } | undefined
    expect(second?.block).toBe(true)
    expect(secondCaptured.selectTitle).toBeUndefined()
  })

  it('an unresolvable choice still fails closed', async () => {
    const { pi, handlers } = makePi()
    const { default: extension } = await import('../src/index.ts')
    extension(pi)
    const captured: Captured = { inputTitles: [], notifies: [] }
    const ctx = makeCtx(captured, async () => '随便什么')

    const outcome = (await handlers.get('tool_call')!(bashEvent('python3 train.py --epochs 3'), ctx)) as { block: boolean } | undefined

    expect(outcome).toEqual({ block: true, reason: 'uncertain' })
    expect(captured.inputTitles).toHaveLength(0)
  })
})

describe('pi slash commands: English registration', () => {
  it('registers /guard with an English description under an English config', async () => {
    const { pi, commands } = makePi()
    const { default: extension } = await import('../src/index.ts')
    extension(pi)
    expect(commands.get('guard')!.description).toBe('Guard runtime: /guard on | off | status | stats | report [days]')
    expect(commands.get('guard-set')!.description).toBe('Guard config & maintenance: /guard-set reload | set-key | show-key | clear-key | set-api | set-api reset')
  })
})
