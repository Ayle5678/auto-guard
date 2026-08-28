import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultGuardConfig, loadConfig, saveConfig } from '../src/config.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cfg-'))
  dirs.push(d)
  return d
}
function defaultsFor(dir = tmp()): ReturnType<typeof defaultGuardConfig> {
  return defaultGuardConfig(dir)
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('config: loading', () => {
  it('creates a default config file when missing', () => {
    const path = join(tmp(), 'config.json')
    const dir = tmp()
    const config = loadConfig(join(dir, 'config.json'), defaultGuardConfig(dir))
    expect(existsSync(join(dir, 'config.json'))).toBe(true)
    expect(config).toEqual(defaultGuardConfig(dir))
  })

  it('defaults notify routing to allow=page, deny/ask=context', () => {
    const defaults = defaultsFor()
    expect(defaults.notifyAllow).toBe('page')
    expect(defaults.notifyDeny).toBe('context')
    expect(defaults.notifyAsk).toBe('context')
  })

  it('defaults experimental audit log to off with a local sqlite path', () => {
    const dir = tmp()
    const defaults = defaultsFor(dir)
    expect(defaults.examineEnabled).toBe(false)
    expect(defaults.auditDbPath).toBe(join(dir, 'audit.db'))
  })

  it('defaults history/auto-analysis switches to off with conservative thresholds', () => {
    const dir = tmp()
    const defaults = defaultsFor(dir)
    expect(defaults.historyEnabled).toBe(false)
    expect(defaults.autoAnalyzeEnabled).toBe(false)
    expect(defaults.historyDays).toBe(60)
    expect(defaults.historyMinTotal).toBe(4)
    expect(defaults.historyMinLlm).toBe(1)
    expect(defaults.learnedCacheableMinTotal).toBe(4)
    expect(defaults.analyzeIntervalMinutes).toBe(20)
    expect(defaults.analyzeIntervalDays).toBe(15)
    expect(defaults.analyzeRowLimit).toBe(5000)
    expect(defaults.templateCachePath).toBe(join(dir, 'template-cache.json'))
    expect(defaults.learnedRulesPath).toBe(join(dir, 'learned-rules.json'))
    expect(defaults.analyzeStatePath).toBe(join(dir, 'analyze-state.json'))
  })

  it('fills missing fields from defaults and writes them back', () => {
    const dir = tmp()
    const path = join(dir, 'config.json')
    writeFileSync(path, JSON.stringify({ enabled: false }), 'utf8')
    const config = loadConfig(path, defaultGuardConfig(dir))
    expect(config.enabled).toBe(false)
    expect(config.model).toBe('deepseek-v4-flash')
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written.model).toBe('deepseek-v4-flash')
  })

  it('keeps only known keys on save (no leakage of internal fields)', () => {
    const dir = tmp()
    const path = join(dir, 'config.json')
    const config = { ...defaultGuardConfig(dir), extraField: 'should-not-persist' } as unknown as ReturnType<typeof defaultGuardConfig>
    saveConfig(config, path)
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written.extraField).toBeUndefined()
    expect(written.enabled).toBe(true)
  })

  it('reflects /guard on|off toggles after save', () => {
    const dir = tmp()
    const path = join(dir, 'config.json')
    const config = loadConfig(path, defaultGuardConfig(dir))
    config.enabled = false
    saveConfig(config, path)
    const reloaded = loadConfig(path, defaultGuardConfig(dir))
    expect(reloaded.enabled).toBe(false)
  })

  it('persists a stored apiKey across reload', () => {
    const dir = tmp()
    const path = join(dir, 'config.json')
    const config = loadConfig(path, defaultGuardConfig(dir))
    config.apiKey = 'sk-test-123'
    saveConfig(config, path)
    expect(loadConfig(path, defaultGuardConfig(dir)).apiKey).toBe('sk-test-123')
  })
})
