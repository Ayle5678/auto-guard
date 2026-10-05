/**
 * Directory-delete tiering boundaries (SPEC 0028 ticket 01): the pure
 * signal→tier judgment. Fake-fs cases pin the exact boundary semantics
 * (depths, caps, name hits, stat failures); two real-fs cases prove the
 * default adapter path.
 *
 * Fake keys go through the same resolve+normalize the module applies, so the
 * fixtures stay true on both platforms (a literal '/ws' would resolve to the
 * current drive on win32 and to depth-1 strict territory at that).
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { normalizePath } from '../src/command.ts'
import { tierForDeletionTargets, type TierDirent, type TierFs, type TierStat } from '../src/delete-tiering.ts'
import type { DirectoryDeletePolicy } from '../src/types.ts'

/** The module's own absolute-key derivation for one fake path. */
const keyOf = (path: string): string => normalizePath(resolve(path))
// Workspaces and zones sit at depth ≥ 3 so their children escape strictMaxDepth.
const WS = keyOf('/fixture/deep/workspace')
const HOME = keyOf('/fixture/home/u')
const OUTSIDE_FILE = keyOf('/fixture/outside/deeper/plain.txt')
const TEMP = keyOf('/fixture/temp-zone')

const policy: DirectoryDeletePolicy = {
  strictMaxDepth: 2,
  largeMinFiles: 1000,
  largeMinBytes: 500 * 1024 * 1024,
  trivialMaxFiles: 200,
  trivialMaxBytes: 50 * 1024 * 1024,
  regenerableNames: ['__pycache__', 'node_modules', '.pytest_cache', '.mypy_cache', '.ruff_cache', '*.egg-info'],
  tempRoots: [],
}

interface FakeTree {
  /** dir key → listing; stat/entries call counts feed the cap assertions. */
  dirs?: Record<string, Array<[name: string, kind: 'file' | 'dir' | 'symlink', bytes?: number]>>
  /** stat overrides keyed by absolute path. */
  stats?: Record<string, { dir?: boolean; file?: boolean; bytes?: number }>
}

function fakeFs(tree: FakeTree = {}) {
  const statCalls: string[] = []
  const entriesCalls: string[] = []
  // Listing-derived file sizes, so scans see bytes without per-file overrides.
  const sizeOf = new Map<string, number>()
  for (const [dir, listing] of Object.entries(tree.dirs ?? {})) {
    for (const [name, kind, bytes] of listing) {
      if (kind === 'file') sizeOf.set(`${dir}/${name}`, bytes ?? 0)
    }
  }
  const fs: TierFs = {
    async stat(path) {
      statCalls.push(path)
      const override = tree.stats?.[path]
      if (override) {
        const info: TierStat = { isFile: Boolean(override.file), isDirectory: Boolean(override.dir), size: override.bytes ?? 0 }
        return info.isFile || info.isDirectory ? info : undefined
      }
      if (sizeOf.has(path)) return { isFile: true, isDirectory: false, size: sizeOf.get(path)! }
      return undefined
    },
    async entries(dir) {
      entriesCalls.push(dir)
      const listing = tree.dirs?.[dir]
      if (!listing) return undefined
      return listing.map(([name, kind]): TierDirent => ({
        name,
        isFile: kind === 'file',
        isDirectory: kind === 'dir',
        isSymlink: kind === 'symlink',
      }))
    },
  }
  return { fs, statCalls, entriesCalls }
}

function tier(overrides: Partial<Parameters<typeof tierForDeletionTargets>[0]> = {}, tree: FakeTree = {}) {
  const { fs, statCalls, entriesCalls } = fakeFs(tree)
  const input = {
    targets: [`${WS}/t`],
    workspace: WS,
    sensitivePaths: ['.env', '*.pem'],
    policy,
    home: HOME,
    fs,
    ...overrides,
  }
  return { result: tierForDeletionTargets(input), statCalls, entriesCalls }
}

describe('tierForDeletionTargets: light boundaries', () => {
  it('a located tree with exactly trivialMaxFiles small files is light', async () => {
    const listing = Array.from({ length: 200 }, (_, i) => [`f${i}`, 'file', 1024] as [string, 'file', number])
    const { result } = tier({}, { stats: { [`${WS}/t`]: { dir: true } }, dirs: { [`${WS}/t`]: listing } })
    expect(await result).toEqual({ tier: 'light', allPlainFiles: false })
  })

  it('one file over the trivial byte cap keeps the target standard', async () => {
    const listing: Array<[string, 'file', number]> = [
      ...Array.from({ length: 199 }, (_, i) => [`f${i}`, 'file', 1024] as [string, 'file', number]),
      ['big', 'file', 50 * 1024 * 1024 + 1],
    ]
    const { result } = tier({}, { stats: { [`${WS}/t`]: { dir: true } }, dirs: { [`${WS}/t`]: listing } })
    expect((await result).tier).toBe('standard')
  })

  it('a regenerable basename hits light without any size scan (nested path)', async () => {
    const target = `${WS}/a/node_modules`
    const { result, entriesCalls } = tier({ targets: [target] }, { stats: { [target]: { dir: true } } })
    expect(await result).toEqual({ tier: 'light', allPlainFiles: false })
    expect(entriesCalls).toHaveLength(0)
  })

  it('the *.egg-info glob suffix also qualifies', async () => {
    const target = `${WS}/pkg.egg-info`
    const { result } = tier({ targets: [target] }, { stats: { [target]: { dir: true } } })
    expect((await result).tier).toBe('light')
  })

  it('a target inside a configured temp root is light even outside the workspace', async () => {
    const target = `${TEMP}/agent-build`
    const { result } = tier(
      { targets: [target], policy: { ...policy, tempRoots: [TEMP] } },
      { stats: { [target]: { dir: true } }, dirs: { [target]: [['x', 'file', 1]] } },
    )
    expect((await result).tier).toBe('light')
  })

  it('a deep target under the OS temp dir defaults to light-eligible', async () => {
    const target = normalizePath(join(tmpdir(), 'agent-build', 'nested'))
    const { result } = tier({ targets: [target], workspace: WS }, { stats: { [target]: { dir: true } }, dirs: { [target]: [] } })
    expect((await result).tier).toBe('light')
  })

  it('a target outside the workspace and temp zones is standard', async () => {
    const { result } = tier({ targets: [OUTSIDE_FILE] }, { stats: { [OUTSIDE_FILE]: { file: true, bytes: 10 } } })
    expect(await result).toEqual({ tier: 'standard', allPlainFiles: true })
  })

  it('the workspace root itself is not "inside" the workspace', async () => {
    const { result } = tier({ targets: [WS] }, { stats: { [WS]: { dir: true } } })
    expect((await result).tier).toBe('standard')
  })
})

describe('tierForDeletionTargets: strict boundaries', () => {
  it('exactly largeMinFiles caps the walk and grades strict without counting the rest', async () => {
    const listing = Array.from({ length: 5000 }, (_, i) => [`f${i}`, 'file', 1] as [string, 'file', number])
    const { result, statCalls } = tier({}, { stats: { [`${WS}/t`]: { dir: true } }, dirs: { [`${WS}/t`]: listing } })
    expect((await result).tier).toBe('strict')
    // 1 target stat + exactly largeMinFiles file stats — never the full 5000.
    expect(statCalls.length).toBe(1 + 1000)
  })

  it('large total bytes cap the walk early on byte count', async () => {
    const listing: Array<[string, 'file', number]> = [
      ['a', 'file', 300 * 1024 * 1024],
      ['b', 'file', 300 * 1024 * 1024],
    ]
    const { result, entriesCalls } = tier({}, { stats: { [`${WS}/t`]: { dir: true } }, dirs: { [`${WS}/t`]: listing } })
    expect((await result).tier).toBe('strict')
    expect(entriesCalls).toHaveLength(1)
  })

  it('a sensitive-path target is strict regardless of depth', async () => {
    const target = keyOf('/fixture/deep/a/b/c/d/.env')
    const { result } = tier({ targets: [target] }, { stats: { [target]: { file: true } } })
    expect((await result).tier).toBe('strict')
  })
})

describe('tierForDeletionTargets: root proximity', () => {
  it.skipIf(process.platform !== 'win32')('one level below the drive root is strict (win32 drive paths)', async () => {
    const target = 'D:/BigDir'
    const { result } = tier(
      { targets: [target], workspace: 'D:/WS', home: 'C:/Users/u' },
      { stats: { [normalizePath(resolve(target))]: { dir: true } } },
    )
    expect((await result).tier).toBe('strict')
  })

  it.skipIf(process.platform !== 'win32')('a shallow target inside the workspace is still strict (grill Q5)', async () => {
    const target = 'D:/ws/x'
    const { result } = tier(
      { targets: [target], workspace: 'D:/WS', home: 'C:/Users/u' },
      { stats: { [normalizePath(resolve(target))]: { dir: true } } },
    )
    expect((await result).tier).toBe('strict')
  })

  it('two levels below home is strict, three is not', async () => {
    const shallow = `${HOME}/a/b`
    const deep = `${HOME}/a/b/c`
    const a = tier({ targets: [shallow] }, { stats: { [shallow]: { dir: true } } })
    const b = tier({ targets: [deep] }, { stats: { [deep]: { dir: true } } })
    expect((await a.result.then((r) => r.tier))).toBe('strict')
    expect((await b.result.then((r) => r.tier))).toBe('standard')
  })

  it.skipIf(process.platform === 'win32')('POSIX root depth counts segments below /', async () => {
    const one = tier({ targets: ['/srv'] }, { stats: { '/srv': { dir: true } } })
    const three = tier({ targets: ['/srv/data/deep'] }, { stats: { '/srv/data/deep': { dir: true } } })
    expect((await one.result.then((r) => r.tier))).toBe('strict')
    expect((await three.result.then((r) => r.tier))).toBe('standard')
  })
})

describe('tierForDeletionTargets: multi-target and failure semantics', () => {
  it('multiple targets take the strictest grade', async () => {
    const { result } = tier(
      { targets: [`${WS}/ok`, `${WS}/bad.pem`] },
      { stats: { [`${WS}/ok`]: { dir: true }, [`${WS}/bad.pem`]: { file: true } }, dirs: { [`${WS}/ok`]: [['f', 'file', 1]] } },
    )
    expect((await result).tier).toBe('strict')
  })

  it('a stat failure keeps the whole deletion standard with allPlainFiles false', async () => {
    const { result } = tier({ targets: [`${WS}/missing`, `${WS}/ok`] }, { stats: { [`${WS}/ok`]: { dir: true } }, dirs: { [`${WS}/ok`]: [] } })
    expect(await result).toEqual({ tier: 'standard', allPlainFiles: false })
  })

  it('mixed plain files and directories keep light while reporting not-all-files', async () => {
    const { result } = tier(
      { targets: [`${WS}/file.txt`, `${WS}/tree`] },
      { stats: { [`${WS}/file.txt`]: { file: true, bytes: 5 }, [`${WS}/tree`]: { dir: true } }, dirs: { [`${WS}/tree`]: [] } },
    )
    expect(await result).toEqual({ tier: 'light', allPlainFiles: false })
  })

  it('all plain files report the fallback signal', async () => {
    const { result } = tier(
      { targets: [`${WS}/a.txt`, `${WS}/b.txt`] },
      { stats: { [`${WS}/a.txt`]: { file: true, bytes: 5 }, [`${WS}/b.txt`]: { file: true, bytes: 5 } } },
    )
    expect(await result).toEqual({ tier: 'light', allPlainFiles: true })
  })

  it('a non-file non-directory stat (socket etc.) is conservative', async () => {
    const { result } = tier({}, { stats: { [`${WS}/t`]: { bytes: 0 } } })
    expect(await result).toEqual({ tier: 'standard', allPlainFiles: false })
  })
})

describe('tierForDeletionTargets: policy fallbacks', () => {
  const cases: Array<[string, unknown]> = [
    ['absent', undefined],
    ['partial', { ...policy, strictMaxDepth: undefined }],
    ['non-positive', { ...policy, largeMinFiles: 0 }],
    ['wrong shape', { ...policy, regenerableNames: 'x' }],
  ]
  for (const [name, value] of cases) {
    it(`a ${name} policy grades everything standard`, async () => {
      const { result } = tier({ policy: value }, { stats: { [`${WS}/t`]: { dir: true } }, dirs: { [`${WS}/t`]: [] } })
      expect(await result).toEqual({ tier: 'standard', allPlainFiles: false })
    })
  }

  it('an empty target set is standard (nothing extractable)', async () => {
    const { result } = tier({ targets: [] })
    expect(await result).toEqual({ tier: 'standard', allPlainFiles: false })
  })
})

describe('tierForDeletionTargets: real fs adapter', () => {
  it('a real temp workspace fixture grades light, and a real plain file reports allPlainFiles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tier-real-'))
    try {
      const cache = join(dir, '__pycache__')
      mkdirSync(cache)
      writeFileSync(join(cache, 'x.pyc'), 'x')
      const light = await tierForDeletionTargets({ targets: ['__pycache__'], workspace: dir, sensitivePaths: [], policy })
      expect(light.tier).toBe('light')
      expect(light.allPlainFiles).toBe(false)

      writeFileSync(join(dir, 'one.txt'), 'hello')
      const files = await tierForDeletionTargets({ targets: ['one.txt'], workspace: dir, sensitivePaths: [], policy })
      expect(files).toEqual({ tier: 'light', allPlainFiles: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
