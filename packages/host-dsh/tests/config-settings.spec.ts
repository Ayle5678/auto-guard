import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, GUARD_SETTINGS_NAMESPACE, installGuardSettings, loadConfig } from '../src/config.ts'
import type { GuardConfig } from '@auto-guard/core'

const dirs: string[] = []

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'dsh-guard-settings-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fakeSettings(initialUser: Record<string, unknown> = {}) {
  let user = { ...initialUser }
  const scope = {
    get: () => ({ ...DEFAULT_CONFIG, ...user }) as GuardConfig,
    update: async (patch: Record<string, unknown>) => {
      Object.assign(user, patch)
    },
    watch: () => () => {},
  }
  const settings = {
    register: () => scope,
    describe: () => [{ ns: GUARD_SETTINGS_NAMESPACE, user }],
  }
  const ctx = {
    inject: (_deps: string[], callback: (sctx: unknown) => void) => callback({ settings }),
  } as never
  return { ctx, scope, user: () => user }
}

describe('config: new user-config fields', () => {
  it('defaults include direct endpoint, key, headless, and audit fields', () => {
    expect(DEFAULT_CONFIG.apiBase).toBe('')
    expect(DEFAULT_CONFIG.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    expect(DEFAULT_CONFIG.apiKey).toBe('')
    expect(DEFAULT_CONFIG.headlessMode).toBe('deny')
    expect(DEFAULT_CONFIG.examineEnabled).toBe(false)
    expect(DEFAULT_CONFIG.auditDbPath).toContain('audit.db')
  })

  it('exposes history/learned user fields in settings defaults', () => {
    expect(DEFAULT_CONFIG.auditPassword).toBe('')
    expect(DEFAULT_CONFIG.historyEnabled).toBe(false)
    expect(DEFAULT_CONFIG.autoAnalyzeEnabled).toBe(false)
    expect(DEFAULT_CONFIG.historyDays).toBe(60)
    expect(DEFAULT_CONFIG.historyMinTotal).toBe(4)
    expect(DEFAULT_CONFIG.historyMinLlm).toBe(1)
    expect(DEFAULT_CONFIG.learnedCacheableMinTotal).toBe(8)
    expect(DEFAULT_CONFIG.analyzeIntervalDays).toBe(15)
  })
})

describe('config: DSH settings migration', () => {
  it('imports legacy user values once when the settings user layer is empty', () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    writeFileSync(legacyPath, JSON.stringify({ enabled: false, model: 'custom-model', apiBase: 'https://example.com', apiKey: 'sk-test' }), 'utf8')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings()
    const handle = installGuardSettings(fake.ctx, config, {}, legacyPath)

    expect(handle.available).toBe(true)
    const user = fake.user()
    // The legacy enabled master switch is not migrated; preset selection is the only toggle.
    expect(user.enabled).toBeUndefined()
    expect(user.model).toBe('custom-model')
    expect(user.apiBase).toBe('https://example.com')
    expect(user.apiKey).toBe('sk-test')
    expect(user.apiKeyMasked).toBe('已配置')
    expect(user.configMigrated).toBe(true)
    // Internal paths are not migrated into settings.
    expect(user.rulesPath).toBeUndefined()
    expect(user.auditDbPath).toBeUndefined()
  })

  it('does not overwrite existing settings user overrides', () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    writeFileSync(legacyPath, JSON.stringify({ model: 'legacy-model' }), 'utf8')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings({ model: 'keep-model' })
    installGuardSettings(fake.ctx, config, {}, legacyPath)

    expect(fake.user().model).toBe('keep-model')
  })
})

describe('config: fallback without settings service', () => {
  it('keeps file-based updates when no settings service is injected', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const ctx = { inject: () => {} } as never
    const handle = installGuardSettings(ctx, config, {}, legacyPath)

    expect(handle.available).toBe(false)
    await handle.update({ model: 'fallback-model' })
    const written = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    expect(written.model).toBe('fallback-model')
    expect(written.enabled).toBeUndefined()
  })
})

describe('config: apiKeyMasked sync', () => {
  it('writes apiKeyMasked when saving an apiKey through settings', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings()
    const handle = installGuardSettings(fake.ctx, config, {}, legacyPath)

    await handle.update({ apiKey: 'sk-1234567890abc321' })
    expect(fake.user().apiKey).toBe('sk-1234567890abc321')
    expect(fake.user().apiKeyMasked).toBe('sk-12*****321')
  })

  it('clears apiKeyMasked when clearing apiKey through settings', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings({ apiKey: 'sk-1234567890abc321', apiKeyMasked: 'sk-12*****321' })
    const handle = installGuardSettings(fake.ctx, config, {}, legacyPath)

    await handle.update({ apiKey: '' })
    expect(fake.user().apiKey).toBe('')
    expect(fake.user().apiKeyMasked).toBe('')
  })

  it('writes apiKeyMasked in fallback file updates', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const ctx = { inject: () => {} } as never
    const handle = installGuardSettings(ctx, config, {}, legacyPath)

    await handle.update({ apiKey: 'sk-1234567890abc321' })
    const written = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    expect(written.apiKey).toBe('sk-1234567890abc321')
    expect(written.apiKeyMasked).toBe('sk-12*****321')
  })
})

describe('config: auditPasswordMasked sync', () => {
  it('writes auditPasswordMasked when saving an auditPassword through settings', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings()
    const handle = installGuardSettings(fake.ctx, config, {}, legacyPath)

    await handle.update({ auditPassword: 'audit-secret-123456' })
    expect(fake.user().auditPassword).toBe('audit-secret-123456')
    expect(fake.user().auditPasswordMasked).toBe('audit*****456')
    expect(fake.user().apiKeyMasked).toBeUndefined()
  })

  it('clears auditPasswordMasked when clearing auditPassword through settings', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const fake = fakeSettings({ auditPassword: 'audit-secret-123456', auditPasswordMasked: 'audit*****456', apiKey: 'sk-1234567890abc321', apiKeyMasked: 'sk-12*****321' })
    const handle = installGuardSettings(fake.ctx, config, {}, legacyPath)

    await handle.update({ auditPassword: '' })
    expect(fake.user().auditPassword).toBe('')
    expect(fake.user().auditPasswordMasked).toBe('')
    expect(fake.user().apiKeyMasked).toBe('sk-12*****321')
  })

  it('writes auditPasswordMasked in fallback file updates', async () => {
    const dir = tmp()
    const legacyPath = join(dir, 'config.json')
    const config = loadConfig(legacyPath)
    const ctx = { inject: () => {} } as never
    const handle = installGuardSettings(ctx, config, {}, legacyPath)

    await handle.update({ auditPassword: 'audit-secret-123456' })
    const written = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    expect(written.auditPassword).toBe('audit-secret-123456')
    expect(written.auditPasswordMasked).toBe('audit*****456')
    expect(written.apiKeyMasked).toBe('')
  })
})
