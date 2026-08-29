import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/shell.ts'
import type { InstallerDeps } from '../../src/installer/install.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-rm-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function installerDeps(home: string): InstallerDeps {
  return {
    home,
    stdinIsTTY: false,
    hasExecutable: (exe) => exe === 'pi',
    runCommand: () => ({ ok: true, stdout: '' }),
    paths: {
      pi: { srcIndex: join(home, 'pkg', 'host-pi', 'src', 'index.ts') },
      zcode: {
        distHookCli: join(home, 'pkg', 'host-zcode', 'dist', 'hook-cli.js'),
        distSessionStart: join(home, 'pkg', 'host-zcode', 'dist', 'session-start.js'),
      },
      dsh: { packageDir: join(home, 'pkg', 'host-dsh') },
    },
  }
}

function seedPi(home: string, settings: string): string {
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true })
  writeFileSync(join(home, '.pi', 'agent', 'settings.json'), settings, 'utf8')
  return join(home, '.pi', 'agent', 'settings.json')
}

describe('auto-guard remove (ticket 04)', () => {
  it('init → remove round-trips an existing settings.json byte-for-byte and consumes the backup', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const original = '{"pi":{"extensions":["mine.ts"]},"keep":true}'
    const settingsPath = seedPi(home, original)

    const init = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(init.code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toBe(original)

    const remove = await runCli(['remove', '--host', 'pi'], { installer: deps })
    expect(remove.code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
    expect(existsSync(`${settingsPath}.auto-guard.bak`)).toBe(false)
  })

  it('structural removal without a backup strips only auto-guard entries', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const settings = JSON.stringify({ pi: { extensions: [deps.paths!.pi.srcIndex, 'mine.ts'] } })
    const settingsPath = seedPi(home, settings)

    const result = await runCli(['remove', '--host', 'pi'], { installer: deps })
    expect(result.code).toBe(0)
    const doc = JSON.parse(readFileSync(settingsPath, 'utf8')) as { pi: { extensions: string[] } }
    expect(doc.pi.extensions).toEqual(['mine.ts'])
  })

  it('zcode structural remove strips events entries and legacy flat-hook garbage', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
    const configPath = join(home, '.zcode', 'cli', 'config.json')
    const ours = (file: string) => ({ type: 'process', command: 'node', args: [join(home, 'pkg', 'host-zcode', 'dist', file)] })
    const damaged = {
      hooks: {
        enabled: true,
        events: { PreToolUse: [{ matcher: 'x', hooks: [ours('hook-cli.js')] }], SessionStart: [] },
        // v0.3.0 leftovers at the flat location ZCode rejects.
        PreToolUse: [{ matcher: 'x', hooks: [ours('hook-cli.js')] }],
        SessionStart: [{ matcher: 'x', hooks: [ours('session-start.js')] }],
      },
      theme: 'dark',
    }
    writeFileSync(configPath, JSON.stringify(damaged), 'utf8')

    const result = await runCli(['remove', '--host', 'zcode'], { installer: deps })
    expect(result.code).toBe(0)
    const doc = JSON.parse(readFileSync(configPath, 'utf8')) as {
      theme: string
      hooks: { enabled: boolean; events: { PreToolUse: unknown[]; SessionStart: unknown[] }; PreToolUse?: unknown[]; SessionStart?: unknown[] }
    }
    expect(doc.theme).toBe('dark')
    expect(doc.hooks.events.PreToolUse).toHaveLength(0)
    expect(doc.hooks.PreToolUse).toBeUndefined()
    expect(doc.hooks.SessionStart).toBeUndefined()
  })

  it('reports 未接入 and leaves files untouched when nothing is installed', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const settingsPath = seedPi(home, '{"pi":{"extensions":["mine.ts"]}}')

    const result = await runCli(['remove', '--host', 'pi'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('未接入')
    expect(readFileSync(settingsPath, 'utf8')).toBe('{"pi":{"extensions":["mine.ts"]}}')
  })

  it('never touches the guard data root ~/.pi/auto-guard/', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const dataRoot = join(home, '.pi', 'auto-guard')
    mkdirSync(dataRoot, { recursive: true })
    writeFileSync(join(dataRoot, 'rules.json'), '{}', 'utf8')
    seedPi(home, '{}')
    await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })

    await runCli(['remove', '--host', 'pi'], { installer: deps })
    expect(existsSync(join(dataRoot, 'rules.json'))).toBe(true)
  })

  it('dsh remove shells out to the native channel; unregistered hosts report 未接入', async () => {
    const home = fakeHome()
    mkdirSync(join(home, '.dsh'), { recursive: true })
    const calls: Array<{ exe: string; args: string[] }> = []
    const deps: InstallerDeps = {
      ...installerDeps(home),
      runCommand: (exe, args) => {
        calls.push({ exe, args })
        if (args[3] === 'remove') return { ok: true, stdout: 'removed' }
        return { ok: true, stdout: 'auto-guard' }
      },
    }
    const result = await runCli(['remove', '--host', 'dsh'], { installer: deps })
    expect(result.code).toBe(0)
    expect(calls.some((c) => c.args.join(' ') === 'plugin --profile web remove auto-guard')).toBe(true)
  })

  it('dsh remove failure when still registered exits 2', async () => {
    const home = fakeHome()
    mkdirSync(join(home, '.dsh'), { recursive: true })
    const deps: InstallerDeps = {
      ...installerDeps(home),
      runCommand: (_exe, args) =>
        args[3] === 'remove' ? { ok: false, stderr: 'permission denied' } : { ok: true, stdout: 'auto-guard' },
    }
    const result = await runCli(['remove', '--host', 'dsh'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('permission denied')
  })

  it('after remove, list reports 未接入 — the guard cannot load in new sessions', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const settingsPath = seedPi(home, '{"pi":{"extensions":[]}}')
    await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    await runCli(['remove', '--host', 'pi'], { installer: deps })

    const list = await runCli(['list'], { installer: deps })
    const piBlock = list.output.join('\n').split('[Pi Coding Agent]')[1] ?? ''
    expect(piBlock).toContain('未接入')
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('remove without --host uninstalls every host and mentions the data roots', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const result = await runCli(['remove'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('auto-guard/ 保留')
  })
})

describe('auto-guard list (ticket 01)', () => {
  it('guides next steps when nothing is detected or integrated', async () => {
    const home = fakeHome()
    const result = await runCli(['list'], { installer: installerDeps(home) })
    const text = result.output.join('\n')
    expect(result.code).toBe(0)
    expect(text).toContain('检测: 否')
    expect(text).toContain('先安装')
    expect(text).toContain('auto-guard init --host pi --yes')
  })

  it('shows 已接入 with a verify hint for an integrated host', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedPi(home, JSON.stringify({ pi: { extensions: [deps.paths!.pi.srcIndex] } }))
    const result = await runCli(['list'], { installer: deps })
    const text = result.output.join('\n')
    expect(text).toContain('已接入')
    expect(text).toContain('guard status')
  })
})
