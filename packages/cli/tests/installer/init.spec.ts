import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../../src/shell.ts'
import { parseInstallerArgs, type InstallerDeps } from '../../src/installer/install.ts'
import { parseSelection } from '../../src/installer/interactive.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-init-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function installerDeps(home: string): InstallerDeps & { paths: Required<InstallerDeps['paths']> } {
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

function seedZcodeDist(home: string): void {
  mkdirSync(join(home, 'pkg', 'host-zcode', 'dist'), { recursive: true })
  writeFileSync(join(home, 'pkg', 'host-zcode', 'dist', 'hook-cli.js'), '// hook', 'utf8')
  writeFileSync(join(home, 'pkg', 'host-zcode', 'dist', 'session-start.js'), '// session', 'utf8')
}

describe('installer flags (ticket 03)', () => {
  it('parses --host csv, --yes and --home', () => {
    const parsed = parseInstallerArgs(['init', '--host', 'pi,zcode', '--yes', '--home', 'X:/h'])
    expect(parsed).toEqual({ ok: true, flags: { command: 'init', hosts: ['pi', 'zcode'], yes: true, home: 'X:/h' } })
  })

  it('accepts --config-root as a no-op (management-only flag)', () => {
    const parsed = parseInstallerArgs(['list', '--config-root', 'X:/irrelevant'])
    expect(parsed.ok).toBe(true)
  })

  it('rejects unknown flags and missing values', () => {
    expect(parseInstallerArgs(['init', '--wat']).ok).toBe(false)
    expect(parseInstallerArgs(['init', '--host']).ok).toBe(false)
  })

  it('selection parser: empty keeps defaults, csv/space forms, rejects junk', () => {
    expect(parseSelection('', 3)).toEqual([])
    expect(parseSelection('1 3', 3)).toEqual([0, 2])
    expect(parseSelection('1，3', 3)).toEqual([0, 2])
    expect(parseSelection('0', 3)).toBeNull()
    expect(parseSelection('x', 3)).toBeNull()
    expect(parseSelection('5', 3)).toBeNull()
  })
})

describe('auto-guard init (tickets 02/03)', () => {
  it('refuses non-TTY interactive runs and points at flags', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const result = await runCli(['init'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('--host')
    expect(result.output.join('\n')).toContain('--yes')
  })

  it('errors on unknown host names and lists valid values', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const result = await runCli(['init', '--host', 'pi,vscode', '--yes'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('未知宿主')
    expect(result.output.join('\n')).toContain('dsh, pi, zcode')
  })

  it('refuses non-detected hosts in non-interactive mode (installer never installs hosts)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const result = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('未检测到')
  })

  it('writes pi extensions and backs up an existing settings.json', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const settingsPath = join(home, '.pi', 'agent', 'settings.json')
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true })
    const original = '{"pi":{"extensions":["existing.ts"]},"theme":"dark"}'
    writeFileSync(settingsPath, original, 'utf8')

    const result = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(result.code).toBe(0)

    const doc = JSON.parse(readFileSync(settingsPath, 'utf8')) as { pi: { extensions: string[] }, theme: string }
    expect(doc.theme).toBe('dark')
    expect(doc.pi.extensions).toContain('existing.ts')
    expect(doc.pi.extensions).toContain(deps.paths!.pi.srcIndex)

    const backupPath = `${settingsPath}.auto-guard.bak`
    expect(existsSync(backupPath)).toBe(true)
    expect(readFileSync(backupPath, 'utf8')).toBe(original)
  })

  it('writes zcode hooks with node + dist args and preserves other config', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedZcodeDist(home)
    mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
    writeFileSync(join(home, '.zcode', 'cli', 'config.json'), '{"theme":"dark"}', 'utf8')

    const result = await runCli(['init', '--host', 'zcode', '--yes'], { installer: deps })
    expect(result.code).toBe(0)

    const doc = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8')) as {
      theme: string
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string; args: string[] }> }>; SessionStart: unknown[] }
    }
    expect(doc.theme).toBe('dark')
    expect(doc.hooks.PreToolUse[0]!.matcher).toBe('^(Bash|Read|Write|Edit|ApplyPatch)$')
    expect(doc.hooks.PreToolUse[0]!.hooks[0]).toMatchObject({ command: 'node', args: [deps.paths!.zcode.distHookCli] })
    expect(doc.hooks.SessionStart).toHaveLength(1)
    expect(result.output.join('\n')).toContain('新开 ZCode 会话')
  })

  it('is idempotent: second run skips, file content and backup mtime stay stable', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true })
    writeFileSync(join(home, '.pi', 'agent', 'settings.json'), '{"pi":{"extensions":[]}}', 'utf8')

    const first = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(first.code).toBe(0)

    const settingsPath = join(home, '.pi', 'agent', 'settings.json')
    const backupPath = `${settingsPath}.auto-guard.bak`
    const contentAfterFirst = readFileSync(settingsPath, 'utf8')
    const backupMtime = statSync(backupPath).mtimeMs

    const second = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(second.code).toBe(0)
    expect(second.output.join('\n')).toContain('已接入')
    expect(readFileSync(settingsPath, 'utf8')).toBe(contentAfterFirst)
    expect(statSync(backupPath).mtimeMs).toBe(backupMtime)
  })

  it('isolates failures: blocked zcode still lets pi install, exit code 2 names the host', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    // No ~/.pi marker? detection needs the dir; dist intentionally missing for zcode.
    mkdirSync(join(home, '.pi'), { recursive: true })
    mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
    writeFileSync(join(home, '.zcode', 'cli', 'config.json'), '{}', 'utf8')

    const result = await runCli(['init', '--host', 'pi,zcode', '--yes'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('缺少构建产物')
    expect(JSON.parse(readFileSync(join(home, '.pi', 'agent', 'settings.json'), 'utf8'))).toBeTruthy()
    expect(result.output.join('\n')).toContain('有 1 个宿主未完成')
    expect(result.output.join('\n')).toContain('zcode')
  })

  it('interactive selection with confirmation (TTY)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    const answers = ['', 'y']
    const testDeps: InstallerDeps = { ...deps, stdinIsTTY: true, readLine: async () => answers.shift() ?? '' }

    const result = await runCli(['init'], { installer: testDeps })
    expect(result.code).toBe(0)
    expect(existsSync(join(home, '.pi', 'agent', 'settings.json'))).toBe(true)
  })

  it('interactive decline writes nothing', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    const answers = ['', 'n']
    const testDeps: InstallerDeps = { ...deps, stdinIsTTY: true, readLine: async () => answers.shift() ?? '' }

    const result = await runCli(['init'], { installer: testDeps })
    expect(result.code).toBe(0)
    expect(existsSync(join(home, '.pi', 'agent', 'settings.json'))).toBe(false)
    expect(result.output.join('\n')).toContain('已跳过')
  })

  it('interactive manual selection of an undetected host requires explicit confirmation', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    // pi is index 2 in [dsh, pi, zcode]; nothing detected.
    const answers = ['2', 'y', 'y']
    const testDeps: InstallerDeps = { ...deps, stdinIsTTY: true, readLine: async () => answers.shift() ?? '' }

    const result = await runCli(['init'], { installer: testDeps })
    expect(result.code).toBe(0)
    expect(existsSync(join(home, '.pi', 'agent', 'settings.json'))).toBe(true)
  })

  it('accepts --config-root before the subcommand (installer ignores it)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    const result = await runCli(['--config-root', 'X:/irrelevant', 'init', '--host', 'pi', '--yes'], { installer: deps })
    expect(result.code).toBe(0)
    expect(existsSync(join(home, '.pi', 'agent', 'settings.json'))).toBe(true)
  })

  it('routes through runCli without any config root (dispatch before config resolution)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    const cliDeps: CliDeps = { installer: deps }
    const result = await runCli(['init', '--host', 'pi', '--yes'], cliDeps)
    expect(result.code).toBe(0)
  })
})
