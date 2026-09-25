import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadApiKey, saveApiKey } from '@auto-guard/core'
import { runCli, type CliDeps } from '../src/shell.ts'

const dirs: string[] = []

function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-sync-'))
  dirs.push(d)
  return d
}

/** One installed host with a seeded auto-guard config (extra dsh-style fields intact). */
function seededRoot(label: string): { label: string; homeDir: string; root: string } {
  const homeDir = home()
  const root = join(homeDir, 'auto-guard')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'config.json'),
    `${JSON.stringify({ provider: 'deepseek-official', apiBase: 'https://old.example.com', model: 'old-model', reasoningEffort: 'off', timeoutMs: 15000 }, null, 2)}\n`,
    'utf8',
  )
  return { label, homeDir, root }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('sync-api: multi-root endpoint write', () => {
  it('patches apiBase/model/fallbackModel on every seeded root, preserving other fields and key order', async () => {
    const a = seededRoot('Host A')
    const b = seededRoot('Host B')
    const unseededHome = home()
    const absentHome = join(home(), 'absent')

    const result = await runCli(
      ['sync-api', 'https://api.deepseek.com', 'deepseek-v4-flash'],
      {
        detectRoot: () => a.homeDir,
        hostRoots: () => [
          { label: 'Absent', homeDir: absentHome, root: join(absentHome, 'auto-guard') },
          { label: 'Unseeded', homeDir: unseededHome, root: join(unseededHome, 'auto-guard') },
          a,
          b,
        ],
      },
    )

    expect(result.code).toBe(0)
    for (const r of [a.root, b.root]) {
      const config = JSON.parse(readFileSync(join(r, 'config.json'), 'utf8'))
      expect(config.apiBase).toBe('https://api.deepseek.com')
      expect(config.model).toBe('deepseek-v4-flash')
      expect(config.fallbackModel).toBe('deepseek-v4-flash')
      expect(config.provider).toBe('deepseek-official')
      expect(config.reasoningEffort).toBe('off')
      expect(config.timeoutMs).toBe(15000)
      expect(Object.keys(config)).toEqual(['provider', 'apiBase', 'model', 'reasoningEffort', 'timeoutMs', 'fallbackModel'])
    }
    expect(existsSync(join(unseededHome, 'auto-guard'))).toBe(false) // skipped roots are not created
    const text = result.output.join('\n')
    expect(text).toContain('已同步 2 个宿主根')
    expect(text).toContain('未播种，跳过')
    expect(text).not.toContain('Absent')
  })

  it('--fallback defaults to the primary model and can be set explicitly', async () => {
    const a = seededRoot('Host A')
    await runCli(['sync-api', 'https://x.example.com', 'm1'], { detectRoot: () => a.homeDir, hostRoots: () => [a] })
    expect(JSON.parse(readFileSync(join(a.root, 'config.json'), 'utf8')).fallbackModel).toBe('m1')

    await runCli(['sync-api', 'https://x.example.com', 'm2', '--fallback', 'm2-fb'], { detectRoot: () => a.homeDir, hostRoots: () => [a] })
    const config = JSON.parse(readFileSync(join(a.root, 'config.json'), 'utf8'))
    expect(config.model).toBe('m2')
    expect(config.fallbackModel).toBe('m2-fb')
  })

  it('--propagate-key copies the current root’s stored key to the other synced roots', async () => {
    const source = seededRoot('Source')
    const target = seededRoot('Target')
    saveApiKey(source.root, 'sk-sync-test-123456')

    const result = await runCli(['sync-api', 'https://x.example.com', 'm1', '--propagate-key'], {
      detectRoot: () => source.root,
      hostRoots: () => [source, target],
    })

    expect(result.code).toBe(0)
    expect(loadApiKey(target.root)).toBe('sk-sync-test-123456')
    expect(result.output.join('\n')).toContain('已复制当前根的加密 Key')
  })

  it('--propagate-key without a stored source key still syncs endpoints and says so', async () => {
    const a = seededRoot('Host A')
    const result = await runCli(['sync-api', 'https://x.example.com', 'm1', '--propagate-key'], {
      detectRoot: () => a.homeDir,
      hostRoots: () => [a],
    })

    expect(result.code).toBe(0)
    const text = result.output.join('\n')
    expect(text).toContain('没有已存的 Key')
    expect(JSON.parse(readFileSync(join(a.root, 'config.json'), 'utf8')).apiBase).toBe('https://x.example.com')
  })

  it('usage/exit 1 on missing or malformed arguments', async () => {
    const a = seededRoot('Host A')
    const deps: CliDeps = { detectRoot: () => a.homeDir, hostRoots: () => [a] }
    for (const argv of [['sync-api'], ['sync-api', 'https://x.example.com'], ['sync-api', '--propagate-key', 'b', 'm'], ['sync-api', 'b', 'm', '--nope'], ['sync-api', 'b', 'm', '--fallback']]) {
      const result = await runCli(argv, deps)
      expect(result.code, argv.join(' ')).toBe(1)
      expect(result.output.join('\n'), argv.join(' ')).toContain('sync-api <base> <model>')
    }
  })

  it('exit 1 with the no-roots notice when nothing is syncable', async () => {
    const result = await runCli(['sync-api', 'https://x.example.com', 'm1'], {
      detectRoot: () => join(home(), '.zcode'),
      hostRoots: () => [],
    })
    expect(result.code).toBe(1)
    expect(result.output.join('\n')).toContain('没有可同步的宿主根')
  })

  it('a corrupt config fails that root only; the others still sync (exit 0)', async () => {
    const a = seededRoot('Host A')
    const b = seededRoot('Host B')
    writeFileSync(join(a.root, 'config.json'), '{not json', 'utf8')

    const result = await runCli(['sync-api', 'https://x.example.com', 'm1'], {
      detectRoot: () => b.homeDir,
      hostRoots: () => [a, b],
    })

    expect(result.code).toBe(0)
    const text = result.output.join('\n')
    expect(text).toContain('写入失败')
    expect(JSON.parse(readFileSync(join(b.root, 'config.json'), 'utf8')).apiBase).toBe('https://x.example.com')
  })
})
