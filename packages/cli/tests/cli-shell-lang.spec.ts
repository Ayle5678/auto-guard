/**
 * Management-CLI language surface (ticket 01): `set lang` persistence with a
 * receipt in the new language, the effective-language line in `guard status`
 * (single-root and aggregate), and the four-layer resolution matrix through
 * the `runCli` seam with injected env and machine-default path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../src/shell.ts'
import { LightAuditStore, writeMachineLang } from '@auto-guard/core'
import type { AuditStore, GuardConfig } from '@auto-guard/core'

const dirs: string[] = []
function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cli-lang-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const fakeAudit = (): AuditStore => new LightAuditStore(join(root(), 'audit.db'))
const depsOf = (extra: Partial<CliDeps> = {}): CliDeps => ({
  makeAudit: fakeAudit,
  detectRoot: () => undefined,
  env: {},
  ...extra,
})

describe('cli: set lang', () => {
  it('persists lang=en, receipts in English, and flips subsequent output', async () => {
    const dir = root()
    const deps = depsOf()
    const set = await runCli(['--config-root', dir, 'set', 'lang', 'en'], deps)
    expect(set.code).toBe(0)
    expect(set.output.join('\n')).toContain('Language set: en')
    expect(set.output.join('\n')).not.toContain('语言')

    const stored = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as GuardConfig
    expect(stored.lang).toBe('en')

    const status = await runCli(['--config-root', dir, 'guard', 'status'], deps)
    const text = status.output.join('\n')
    expect(text).toContain('lang    : en')
    expect(text).toContain('no API Key (fail-closed)')

    const usage = await runCli(['--config-root', dir, 'optimize'], deps)
    expect(usage.output.join('\n')).toContain('Usage: auto-guard optimize')
  })

  it('persists lang=zh with a Chinese receipt', async () => {
    const dir = root()
    const deps = depsOf()
    const set = await runCli(['--config-root', dir, 'set', 'lang', 'zh'], deps)
    expect(set.code).toBe(0)
    expect(set.output.join('\n')).toContain('语言已设置：zh')
    const stored = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as GuardConfig
    expect(stored.lang).toBe('zh')
  })

  it('rejects unknown values and lists the available ones', async () => {
    const dir = root()
    const deps = depsOf()
    const bad = await runCli(['--config-root', dir, 'set', 'lang', 'fr'], deps)
    expect(bad.code).toBe(1)
    expect(bad.output.join('\n')).toContain('无效语言值：fr')
    expect(bad.output.join('\n')).toContain('zh、en')
    const none = await runCli(['--config-root', dir, 'set', 'lang'], deps)
    expect(none.code).toBe(1)
    // Nothing may be persisted on failure.
    if (existsSync(join(dir, 'config.json'))) {
      expect((JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as GuardConfig).lang).toBeUndefined()
    }
  })
})

describe('cli: four-layer resolution through guard status', () => {
  it('env beats config, config beats machine default, machine default beats zh', async () => {
    const dir = root()
    // Machine default en.
    const machineFile = join(root(), '.auto-guard', 'config.json')
    writeMachineLang(machineFile, 'en')
    const deps = depsOf({ machineLangPath: machineFile })

    // Layer 4: zh fallback.
    expect((await runCli(['--config-root', dir, 'guard', 'status'], depsOf())).output.join('\n')).toContain('lang    : zh')
    // Layer 3: machine default.
    expect((await runCli(['--config-root', dir, 'guard', 'status'], deps)).output.join('\n')).toContain('lang    : en')
    // Layer 2: per-host config beats machine default.
    await runCli(['--config-root', dir, 'set', 'lang', 'zh'], deps)
    expect((await runCli(['--config-root', dir, 'guard', 'status'], deps)).output.join('\n')).toContain('lang    : zh')
    // Layer 1: env beats everything.
    expect((await runCli(['--config-root', dir, 'guard', 'status'], depsOf({ machineLangPath: machineFile, env: { AUTO_GUARD_LANG: 'en' } }))).output.join('\n')).toContain('lang    : en')
  })

  it('aggregate status shows one language line per host root', async () => {
    const machineFile = join(root(), '.auto-guard', 'config.json')
    writeMachineLang(machineFile, 'en')
    const piHome = root()
    const piRoot = join(piHome, 'auto-guard')
    mkdirSync(piRoot, { recursive: true })
    writeFileSync(join(piRoot, 'config.json'), JSON.stringify({ enabled: true, lang: 'zh' }), 'utf8')

    const zcHome = root()
    const zcRoot = join(zcHome, '.zcode', 'auto-guard')
    mkdirSync(zcRoot, { recursive: true })
    writeFileSync(join(zcRoot, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

    const result = await runCli(['guard', 'status'], {
      ...depsOf({ machineLangPath: machineFile, detectRoot: () => piHome }),
      hostRoots: () => [
        { label: 'Pi Coding Agent', homeDir: piHome, root: piRoot },
        { label: 'ZCode', homeDir: zcHome, root: zcRoot },
      ],
    })
    const text = result.output.join('\n')
    // pi root follows its own zh; zcode root (lang unset) follows the machine default en.
    expect(text).toContain('lang    : zh')
    expect(text).toContain('lang    : en')
  })
})
