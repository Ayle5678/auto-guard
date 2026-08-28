import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AUTO_GUARD_DIR, defaultConfig, loadConfig, saveConfig } from '../src/config.ts'
import { PI_CAPABILITIES } from '../src/pi-capabilities.ts'
import { usesFourStateAsk } from '@auto-guard/core'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-pi-cfg-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('pi config root (ADR-0003)', () => {
  it('keeps the historical ~/.pi/auto-guard root for zero-migration upgrades', () => {
    expect(AUTO_GUARD_DIR).toBe(join(homedir(), '.pi', 'auto-guard'))
    expect(defaultConfig().rulesPath).toBe(join(AUTO_GUARD_DIR, 'rules.json'))
  })

  it('creates a default config on first load and back-fills missing keys', () => {
    const dir = tmp()
    const path = join(dir, 'config.json')
    const first = loadConfig(path)
    expect(existsSync(path)).toBe(true)
    expect(first.enabled).toBe(true)
    expect(first.timeoutMs).toBe(8000)

    writeFileSync(path, JSON.stringify({ enabled: false }), 'utf8')
    const reloaded = loadConfig(path)
    expect(reloaded.enabled).toBe(false)
    expect(reloaded.model).toBe(defaultConfig().model)
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written.model).toBe(defaultConfig().model)
  })

  it('save → load round-trips a toggle', () => {
    const path = join(tmp(), 'config.json')
    const config = loadConfig(path)
    config.enabled = false
    saveConfig(config, path)
    expect(loadConfig(path).enabled).toBe(false)
  })
})

describe('pi capabilities (ADR-0007)', () => {
  it('declares four-state ask, memory session state and both channels', () => {
    expect(PI_CAPABILITIES.askStyle).toBe('four-state')
    expect(PI_CAPABILITIES.sessionState).toBe('memory')
    expect(PI_CAPABILITIES.userBash).toBe(true)
    expect(PI_CAPABILITIES.notifyChannels).toEqual({ page: true, context: true })
    expect(usesFourStateAsk(PI_CAPABILITIES)).toBe(true)
  })
})
