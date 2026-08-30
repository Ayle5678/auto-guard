/**
 * Installer machine-default language wiring (ticket 04): the interactive
 * choice and `--lang` both persist to <home>/.auto-guard/config.json
 * immediately, later inits never re-ask, `remove` keeps the preference, and
 * an English install writes the ZCode hook statusMessage in English without
 * rewriting existing (marker-matched) entries.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../../src/shell.ts'
import type { InstallerDeps } from '../../src/installer/install.ts'
import { machineConfigPath } from '@auto-guard/core'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-init-lang-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function installerDeps(home: string, answers: string[] = []): InstallerDeps {
  return {
    home,
    // Interactive only when answers are provided (stdinIsTTY flips with them).
    stdinIsTTY: answers.length > 0,
    readLine: answers.length > 0 ? async () => answers.shift() ?? '' : undefined,
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
      codex: {
        distHookCli: join(home, 'pkg', 'host-codex', 'dist', 'hook-cli.js'),
        distSessionStart: join(home, 'pkg', 'host-codex', 'dist', 'session-start.js'),
      },
    },
  }
}

function seedPi(home: string): void {
  mkdirSync(join(home, '.pi'), { recursive: true })
}

function seedZcode(home: string): void {
  mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
  writeFileSync(join(home, '.zcode', 'cli', 'config.json'), '{}', 'utf8')
  mkdirSync(join(home, 'pkg', 'host-zcode', 'dist'), { recursive: true })
  writeFileSync(join(home, 'pkg', 'host-zcode', 'dist', 'hook-cli.js'), '// hook', 'utf8')
  writeFileSync(join(home, 'pkg', 'host-zcode', 'dist', 'session-start.js'), '// session', 'utf8')
}

describe('installer: machine default language persistence', () => {
  it('the interactive choice is written immediately, before the install outcome', async () => {
    const home = fakeHome()
    seedPi(home)
    // '2' picks English, then decline the only write so the install "fails".
    const result = await runCli(['init'], { installer: installerDeps(home, ['2', '', 'n']) })
    expect(result.output.join('\n')).toContain('skipped')
    const machine = JSON.parse(readFileSync(machineConfigPath(home), 'utf8')) as { lang?: string }
    expect(machine.lang).toBe('en')
  })

  it('a second init reads the machine default and never re-asks', async () => {
    const home = fakeHome()
    seedPi(home)
    // First run: pick English ('2'), accept defaults, confirm.
    await runCli(['init'], { installer: installerDeps(home, ['2', '', 'y']) })
    expect((JSON.parse(readFileSync(machineConfigPath(home), 'utf8')) as { lang?: string }).lang).toBe('en')

    // Second run: no language answer provided — the prompt must not appear.
    const second = await runCli(['init'], {
      installer: installerDeps(home, ['', 'y']),
    })
    expect(second.code).toBe(0)
    // English came from the machine default, not from a prompt.
    expect(second.output.join('\n')).not.toContain('Select language')
    expect(second.output.join('\n')).toContain('already integrated')
  })

  it('init --lang en updates the machine default in a non-interactive run', async () => {
    const home = fakeHome()
    seedPi(home)
    const result = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    expect((JSON.parse(readFileSync(machineConfigPath(home), 'utf8')) as { lang?: string }).lang).toBe('en')
    // A later bare non-interactive list run follows the machine default.
    const list = await runCli(['list'], { installer: installerDeps(home) })
    expect(list.output.join('\n')).toContain('Detected:')
  })

  it('remove keeps the machine default file', async () => {
    const home = fakeHome()
    seedPi(home)
    await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en'], { installer: installerDeps(home) })
    const removed = await runCli(['remove', '--host', 'pi', '--yes', '--lang', 'en'], { installer: installerDeps(home) })
    expect(removed.code).toBe(0)
    expect((JSON.parse(readFileSync(machineConfigPath(home), 'utf8')) as { lang?: string }).lang).toBe('en')
  })
})

describe('installer: ZCode statusMessage follows the install language', () => {
  it('an English install writes English spinner text into the hook entries', async () => {
    const home = fakeHome()
    seedZcode(home)
    const result = await runCli(['init', '--host', 'zcode', '--yes', '--lang', 'en'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    const config = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8')) as {
      hooks: { events: { PreToolUse: Array<{ hooks: Array<{ statusMessage: string }> }>; SessionStart: Array<{ hooks: Array<{ statusMessage: string }> }> } }
    }
    expect(config.hooks.events.PreToolUse[0]!.hooks[0]!.statusMessage).toBe('🛡️ auto-guard reviewing…')
    expect(config.hooks.events.SessionStart[0]!.hooks[0]!.statusMessage).toBe('🛡️ auto-guard session init')
  })

  it('a Chinese install keeps the Chinese spinner text', async () => {
    const home = fakeHome()
    seedZcode(home)
    const result = await runCli(['init', '--host', 'zcode', '--yes', '--lang', 'zh'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    const config = JSON.parse(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8')) as {
      hooks: { events: { PreToolUse: Array<{ hooks: Array<{ statusMessage: string }> }> } }
    }
    expect(config.hooks.events.PreToolUse[0]!.hooks[0]!.statusMessage).toBe('🛡️ auto-guard 安全审查中…')
  })

  it('re-running init in another language never rewrites an installed entry (marker idempotence)', async () => {
    const home = fakeHome()
    seedZcode(home)
    await runCli(['init', '--host', 'zcode', '--yes', '--lang', 'zh'], { installer: installerDeps(home) })
    const before = readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8')
    const again = await runCli(['init', '--host', 'zcode', '--yes', '--lang', 'en'], { installer: installerDeps(home) })
    expect(again.code).toBe(0)
    expect(again.output.join('\n')).toContain('already integrated')
    expect(readFileSync(join(home, '.zcode', 'cli', 'config.json'), 'utf8')).toBe(before)
  })
})
