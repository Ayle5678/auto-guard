import { describe, expect, it } from 'vitest'
import { buildInitArgv, buildRemoveArgv, execRun, injectConfigRoot, loadRootSummaries, validateWizard } from '../src/actions.ts'

describe('injectConfigRoot', () => {
  it('appends when missing and keeps explicit root', () => {
    expect(injectConfigRoot(['guard', 'status'], '/r')).toEqual(['guard', 'status', '--config-root', '/r'])
    expect(injectConfigRoot(['guard', 'status', '--config-root', '/x'], '/r')).toEqual(['guard', 'status', '--config-root', '/x'])
    expect(injectConfigRoot(['list'], '')).toEqual(['list'])
  })
})

describe('execRun', () => {
  it('routes management commands through runCli with root injected, records user-facing argv', async () => {
    const seen: (readonly string[])[] = []
    const receipt = await execRun({ runCli: async (argv) => (seen.push(argv), { code: 0, output: ['ok'] }) }, { kind: 'mgmt', argv: ['guard', 'status'], label: 'guard status' }, '/root', 7)
    expect(seen).toEqual([['guard', 'status', '--config-root', '/root']])
    expect(receipt).toMatchObject({ id: 7, code: 0, argv: 'guard status', output: ['ok'] })
  })

  it('strips even explicit --config-root from the display argv (SPEC 0011)', async () => {
    const receipt = await execRun({ runCli: async () => ({ code: 0, output: [] }) }, { kind: 'mgmt', argv: ['guard', 'ping', '--config-root', '/focused'], label: 'guard ping' }, '/root', 2)
    expect(receipt.argv).toBe('guard ping')
  })

  it('routes installer commands non-interactively', async () => {
    const seen: Array<[readonly string[], unknown]> = []
    await execRun(
      {
        runInstaller: async (argv, deps) => {
          seen.push([argv, deps])
          return { code: 0, output: [] }
        },
      },
      { kind: 'inst', argv: ['init', '--host', 'pi', '--yes'], label: 'init' },
      '/root',
      1,
    )
    expect(seen[0]![0]).toEqual(['init', '--host', 'pi', '--yes'])
    // The installer must never take over the TUI's raw-mode terminal.
    expect(seen[0]![1]).toMatchObject({ stdinIsTTY: false, banner: false })
  })
})

describe('wizard validation', () => {
  const input = (over: Partial<Parameters<typeof validateWizard>[0]>) => ({
    base: '',
    model: '',
    key: 'sk-good-key',
    currentBase: 'https://api.local',
    currentModel: 'm',
    ...over,
  })
  it('accepts empty base (keep current) and a valid key', () => {
    expect(validateWizard(input({}))).toMatchObject({ ok: true })
  })
  it('rejects non-http base', () => {
    expect(validateWizard(input({ base: 'ftp://x' }))).toEqual({ ok: false, error: 'invalidBase' })
  })
  it('rejects short and whitespace keys', () => {
    expect(validateWizard(input({ key: 'short' }))).toEqual({ ok: false, error: 'invalidKey' })
    expect(validateWizard(input({ key: 'has space inside' }))).toEqual({ ok: false, error: 'invalidKey' })
  })
})

describe('installer argv builders', () => {
  it('orders hosts canonically and pins the rule flag', () => {
    expect(buildInitArgv(['qoder', 'pi'], 'update', 'en')).toEqual([
      'init',
      '--host',
      'pi,qoder',
      '--update-rules',
      '--yes',
      '--lang',
      'en',
    ])
    expect(buildInitArgv(['dsh'], 'skip', 'zh')).toContain('--skip-rules')
  })
  it('remove argv is ordered and non-interactive', () => {
    expect(buildRemoveArgv(['zcode', 'dsh'])).toEqual(['remove', '--host', 'dsh,zcode', '--yes'])
  })
})

describe('loadRootSummaries', () => {
  it('classifies seeded / unseeded / absent hosts without touching unseeded roots', async () => {
    const { mkdtempSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = mkdtempSync(join(tmpdir(), 'ag-tui-sum-'))
    // zcode: host installed + seeded; pi: host installed, guard never ran.
    const zcodeRoot = join(home, '.zcode', 'auto-guard')
    mkdirSync(zcodeRoot, { recursive: true })
    writeFileSync(join(zcodeRoot, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')
    mkdirSync(join(home, '.pi'), { recursive: true })
    const summaries = loadRootSummaries({ home, exists: existsSync })
    const zcode = summaries.find((s) => s.hostId === 'zcode')!
    const pi = summaries.find((s) => s.hostId === 'pi')!
    expect(zcode.installed && zcode.seeded).toBe(true)
    expect(zcode.config?.enabled).toBe(true)
    expect(pi.installed).toBe(true)
    expect(pi.seeded).toBe(false)
    expect(pi.config).toBeUndefined()
    const claude = summaries.find((s) => s.hostId === 'claude')!
    expect(claude.installed).toBe(false)
  })
})

describe('saveWizard success path', () => {
  it('stores the encrypted key and persists endpoint changes', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { saveWizard } = await import('../src/actions.ts')
    const { hasStoredApiKey } = await import('@auto-guard/core')
    const home = mkdtempSync(join(tmpdir(), 'ag-tui-wiz-'))
    const root = join(home, '.zcode', 'auto-guard')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'config.json'), JSON.stringify({ apiBase: 'https://old', model: 'old-model' }), 'utf8')
    const outcome = saveWizard(root, { base: 'https://new', model: 'new-model', key: 'sk-test-1234', currentBase: 'https://old', currentModel: 'old-model' }, 'zh')
    expect(outcome.changedEndpoint).toBe(true)
    expect(hasStoredApiKey(root)).toBe(true)
    const saved = JSON.parse((await import('node:fs')).readFileSync(join(root, 'config.json'), 'utf8'))
    expect(saved.apiBase).toBe('https://new')
    expect(saved.model).toBe('new-model')
  })
})
