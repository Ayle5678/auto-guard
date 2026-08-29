import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectHosts } from '../../src/installer/detect.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-detect-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('host detector (ticket 01)', () => {
  it('reports nothing detected on an empty HOME', () => {
    const results = detectHosts({ home: fakeHome(), hasExecutable: () => false })
    expect(results.map((r) => r.detected)).toEqual([false, false, false, false, false])
    const any = results.every((r) => r.confidence === 'none')
    expect(any).toBe(true)
  })

  it('detects claude via ~/.claude/settings.json alone and opencode via opencode.json', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), '{}', 'utf8')
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), '{}', 'utf8')
    const results = detectHosts({ home, hasExecutable: () => false })
    const claude = results.find((r) => r.profile.id === 'claude')!
    expect(claude.detected).toBe(true)
    expect(claude.confidence).toBe('high')
    const opencode = results.find((r) => r.profile.id === 'opencode')!
    expect(opencode.detected).toBe(true)
    expect(opencode.confidence).toBe('high')
  })

  it('treats claude/opencode directory-only findings as medium confidence (AND semantics)', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.claude'))
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    const results = detectHosts({ home, hasExecutable: () => false })
    const claude = results.find((r) => r.profile.id === 'claude')!
    expect(claude.detected).toBe(false)
    expect(claude.confidence).toBe('medium')
    const opencode = results.find((r) => r.profile.id === 'opencode')!
    expect(opencode.detected).toBe(false)
    expect(opencode.confidence).toBe('medium')
  })

  it('detects claude and opencode via executable probe (dirs + executables)', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.claude'))
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    const results = detectHosts({ home, hasExecutable: (exe) => exe === 'claude' || exe === 'opencode' })
    expect(results.find((r) => r.profile.id === 'claude')!.detected).toBe(true)
    expect(results.find((r) => r.profile.id === 'opencode')!.detected).toBe(true)
  })

  it('detects dsh via ~/.dsh + executable with high confidence and evidence', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.dsh'))
    const results = detectHosts({ home, hasExecutable: (exe) => exe === 'dsh' })
    const dsh = results.find((r) => r.profile.id === 'dsh')!
    expect(dsh.detected).toBe(true)
    expect(dsh.confidence).toBe('high')
    expect(dsh.evidence.some((e) => e.includes('.dsh'))).toBe(true)
    expect(dsh.evidence.some((e) => e.includes('dsh'))).toBe(true)
  })

  it('detects zcode via ~/.zcode/cli/config.json alone (no executable probe)', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.zcode', 'cli'), { recursive: true })
    writeFileSync(join(home, '.zcode', 'cli', 'config.json'), '{}', 'utf8')
    const results = detectHosts({ home, hasExecutable: () => false })
    const zcode = results.find((r) => r.profile.id === 'zcode')!
    expect(zcode.detected).toBe(true)
    expect(zcode.confidence).toBe('high')
  })

  it('treats directory-only findings as medium-confidence, not detected (AND semantics)', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.pi'))
    const results = detectHosts({ home, hasExecutable: () => false })
    const pi = results.find((r) => r.profile.id === 'pi')!
    expect(pi.detected).toBe(false)
    expect(pi.confidence).toBe('medium')
    expect(pi.evidence.some((e) => e.includes('.pi'))).toBe(true)
  })

  it('defaults hasExecutable to a PATH scan (no throws, boolean result)', () => {
    const results = detectHosts({ home: fakeHome() })
    expect(results.every((r) => typeof r.detected === 'boolean')).toBe(true)
    expect(existsSync).toBeTypeOf('function')
  })
})
