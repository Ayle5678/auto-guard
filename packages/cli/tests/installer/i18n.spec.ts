import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/shell.ts'
import { message, normalizeLang } from '../../src/installer/i18n.ts'
import { isConfirmed, parseSelection, promptLanguage } from '../../src/installer/interactive.ts'
import { parseInstallerArgs, type InstallerDeps } from '../../src/installer/install.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-i18n-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  delete process.env.AUTO_GUARD_LANG
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
      claude: {
        distHookCli: join(home, 'pkg', 'host-claude', 'dist', 'hook-cli.js'),
        distSessionStart: join(home, 'pkg', 'host-claude', 'dist', 'session-start.js'),
      },
      opencode: { distPluginDir: join(home, 'pkg', 'host-opencode', 'dist') },
      qoder: {
        distHookCli: join(home, 'pkg', 'host-qoder', 'dist', 'hook-cli.js'),
        distSessionStart: join(home, 'pkg', 'host-qoder', 'dist', 'session-start.js'),
      },
    },
  }
}

function seedPi(home: string): void {
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true })
  writeFileSync(join(home, '.pi', 'agent', 'settings.json'), '{"pi":{"extensions":[]}}', 'utf8')
}

describe('catalog and helpers', () => {
  it('message interpolates {params} in both languages; unknown keys are type-rejected', () => {
    expect(message('zh', 'unknownHosts', { hosts: 'x', valid: 'dsh, pi, zcode' })).toBe('未知宿主：x（可用值：dsh, pi, zcode）')
    expect(message('en', 'unknownHosts', { hosts: 'x', valid: 'dsh, pi, zcode' })).toBe('Unknown host(s): x (valid values: dsh, pi, zcode)')
    expect(message('en', 'confirmWrite', { label: 'ZCode' })).toBe('Write to ZCode? (y/N): ')
  })

  it('normalizeLang accepts regional tags and rejects junk', () => {
    expect(normalizeLang('en')).toBe('en')
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang(' zh-CN ')).toBe('zh')
    expect(normalizeLang('fr')).toBeUndefined()
    expect(normalizeLang(undefined)).toBeUndefined()
  })

  it('language prompt parses numbers and names, re-asks on junk with a bilingual hint', async () => {
    const prompts: string[] = []
    const answers = ['x', '2']
    const lang = await promptLanguage(async (prompt) => {
      prompts.push(prompt)
      return answers.shift() ?? ''
    })
    expect(lang).toBe('en')
    expect(prompts[0]).toContain('请选择语言 / Select language')
    expect(prompts[0]).not.toContain('无效输入')
    expect(prompts[1]).toContain('无效输入，请输入 1 或 2 / invalid input, enter 1 or 2')
  })

  it('language prompt defaults to 中文 on bare Enter', async () => {
    expect(await promptLanguage(async () => '')).toBe('zh')
    expect(await promptLanguage(async () => '1')).toBe('zh')
    expect(await promptLanguage(async () => 'english')).toBe('en')
  })

  it('confirm and selection parsing are language-neutral', () => {
    expect(isConfirmed('y')).toBe(true)
    expect(isConfirmed('是')).toBe(true)
    expect(isConfirmed('no')).toBe(false)
    expect(parseSelection('1,3', 3)).toEqual([0, 2])
  })

  it('parse errors speak the requested language', () => {
    expect(parseInstallerArgs(['wat'], 'en')).toMatchObject({ ok: false, message: expect.stringContaining('Usage: auto-guard') })
    expect(parseInstallerArgs(['init', '--wat'], 'en')).toMatchObject({ ok: false, message: expect.stringContaining('Unknown flag') })
    expect(parseInstallerArgs(['wat'])).toMatchObject({ ok: false, message: expect.stringContaining('用法：auto-guard') })
    expect(parseInstallerArgs(['init', '--lang', 'fr'])).toMatchObject({ ok: false, message: expect.stringContaining('invalid --lang value') })
    expect(parseInstallerArgs(['init', '--lang=en']).ok).toBe(true)
  })
})

describe('installer output language', () => {
  it('interactive init asks the language right after the banner; choosing English renders the whole flow in English', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    const prompts: string[] = []
    const answers = ['2', '', 'y']
    const testDeps: InstallerDeps = {
      ...deps,
      stdinIsTTY: true,
      readLine: async (prompt) => {
        prompts.push(prompt)
        return answers.shift() ?? ''
      },
    }

    const result = await runCli(['init'], { installer: testDeps })
    expect(result.code).toBe(0)
    expect(prompts[0]).toContain('Select language')
    expect(prompts[1]).toContain('pick the ones to integrate')
    const text = result.output.join('\n')
    expect(text).toContain('Installation complete:')
    expect(text).toContain('takes effect in a new session')
    expect(text).not.toContain('安装完成')
  })

  it('--lang en renders the non-interactive flow in English', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedPi(home)
    const result = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en'], { installer: deps })
    expect(result.code).toBe(0)
    const text = result.output.join('\n')
    expect(text).toContain('Installation complete:')
    expect(text).toContain('Write ~/.pi/agent/settings.json')
    expect(text).not.toContain('写入')
  })

  it('AUTO_GUARD_LANG=en pins the language without the flag', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedPi(home)
    process.env.AUTO_GUARD_LANG = 'en'
    const result = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('Installation complete:')
  })

  it('non-TTY without pinning stays Chinese (piped/CI output is stable)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedPi(home)
    const result = await runCli(['init', '--host', 'pi', '--yes'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('安装完成：')
  })

  it('invalid --lang is rejected with a fixed bilingual message', async () => {
    const home = fakeHome()
    const result = await runCli(['init', '--lang', 'fr', '--host', 'pi', '--yes'], { installer: installerDeps(home) })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('invalid --lang value: fr')
    expect(result.output.join('\n')).toContain('无效 --lang 值')
  })

  it('list --lang en reports detection and integration in English', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    const result = await runCli(['list', '--lang=en'], { installer: deps })
    const text = result.output.join('\n')
    expect(result.code).toBe(0)
    expect(text).toContain('Detected: no')
    expect(text).toContain('Install Pi Coding Agent first, then run auto-guard init --host pi --yes')
  })

  it('remove --lang en reports the data-retention note in English', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    seedPi(home)
    const result = await runCli(['remove', '--host', 'pi', '--lang', 'en'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('guard user data under ~/.<host>/auto-guard/ is kept')
  })

  it('blocked plans localize their reason (missing build artifacts)', async () => {
    const home = fakeHome()
    const deps = installerDeps(home)
    mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
    writeFileSync(join(home, '.zcode', 'cli', 'config.json'), '{}', 'utf8')
    const result = await runCli(['init', '--host', 'zcode', '--yes', '--lang', 'en'], { installer: deps })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('missing build artifact(s)')
  })
})
