/**
 * Configuration loading and persistence for the DSH host.
 *
 * Config lives at `~/.dsh/auto-guard/config.json` as the legacy/fallback
 * store. When DSH's settings service is available, the `auto-guard` namespace
 * in the DSH settings document becomes the primary source; legacy values are
 * imported once and the settings scope is kept in sync.
 *
 * The settings schema is built with a tiny structural builder so the module
 * stays loadable without the proprietary SDK installed (tests, CLI tooling);
 * inside DSH the resolved schema object is passed straight to
 * `settings.register` which consumes its shape. Secret-role fields
 * (`apiKey`, `auditPassword`) are declared via `.role('secret')`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expandHome } from '@auto-guard/core'
import type { Context } from '@deepseek-ai/cordis'
import type { GuardConfig } from '@auto-guard/core'

export const AUTO_GUARD_DIR = join(expandHome('~'), '.dsh', 'auto-guard')
export const DEFAULT_CONFIG_PATH = join(AUTO_GUARD_DIR, 'config.json')
/** Opaque namespace token handed to the DSH settings service. */
export const GUARD_SETTINGS_NAMESPACE = { ns: 'auto-guard' }

export const DEFAULT_CONFIG: GuardConfig = {
  // Present for GuardConfig compatibility only; never persisted and never
  // consulted — the permission preset is the only on/off switch on DSH.
  enabled: true,
  rulesPath: join(AUTO_GUARD_DIR, 'rules.json'),
  defaultRulesPath: join(AUTO_GUARD_DIR, 'defaults.json'),
  cachePath: join(AUTO_GUARD_DIR, 'cache.json'),
  apiBase: '',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  apiKey: '',
  apiKeyMasked: '',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'off',
  fallbackProvider: 'deepseek-official',
  fallbackModel: 'deepseek-v4-flash',
  timeoutMs: 15000,
  lowRiskTtlDays: 30,
  mediumRiskTtlDays: 7,
  onTimeout: 'deny',
  headlessMode: 'deny',
  notifyCacheHit: true,
  notifyLlmDecision: true,
  notifyAllow: 'page',
  notifyDeny: 'context',
  notifyAsk: 'context',
  fileTrackerDefault: 'ask',
  fileTrackerWindowSec: 5,
  sessionCacheSize: 256,
  alwaysReviewCacheTtlMinutes: 30,
  examineEnabled: false,
  auditDbPath: join(AUTO_GUARD_DIR, 'audit.db'),
  auditPassword: '',
  auditPasswordMasked: '',
  historyEnabled: false,
  autoAnalyzeEnabled: false,
  historyDays: 60,
  historyMinTotal: 4,
  historyMinLlm: 1,
  learnedCacheableMinTotal: 8,
  analyzeIntervalMinutes: 0,
  analyzeIntervalDays: 15,
  analyzeRowLimit: 5000,
  templateCachePath: join(AUTO_GUARD_DIR, 'template-cache.json'),
  learnedRulesPath: join(AUTO_GUARD_DIR, 'learned-rules.json'),
  learnedBackupPath: join(AUTO_GUARD_DIR, 'learned-rules.backup.json'),
  analyzeStatePath: join(AUTO_GUARD_DIR, 'analyze-state.json'),
}

/** Build the non-secret masked display value for a secret string. */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '已配置'
  return `${value.slice(0, 5)}*****${value.slice(-3)}`
}

/** Build the non-secret masked display value for a locally stored API key. */
export function maskApiKey(apiKey: string): string {
  return maskSecret(apiKey)
}

const CONFIG_KEYS: Array<keyof GuardConfig> = [
  'rulesPath',
  'defaultRulesPath',
  'cachePath',
  'apiBase',
  'apiKeyEnv',
  'apiKey',
  'apiKeyMasked',
  'provider',
  'model',
  'reasoningEffort',
  'fallbackProvider',
  'fallbackModel',
  'timeoutMs',
  'lowRiskTtlDays',
  'mediumRiskTtlDays',
  'onTimeout',
  'headlessMode',
  'notifyCacheHit',
  'notifyLlmDecision',
  'notifyAllow',
  'notifyDeny',
  'notifyAsk',
  'fileTrackerDefault',
  'fileTrackerWindowSec',
  'sessionCacheSize',
  'alwaysReviewCacheTtlMinutes',
  'examineEnabled',
  'auditDbPath',
  'auditPassword',
  'auditPasswordMasked',
  'historyEnabled',
  'autoAnalyzeEnabled',
  'historyDays',
  'historyMinTotal',
  'historyMinLlm',
  'learnedCacheableMinTotal',
  'analyzeIntervalMinutes',
  'analyzeIntervalDays',
  'analyzeRowLimit',
  'templateCachePath',
  'learnedRulesPath',
  'learnedBackupPath',
  'analyzeStatePath',
  'configMigrated',
]

/** User-facing settings keys: everything except internal file paths and the migration marker. */
export const USER_CONFIG_KEYS: Array<keyof GuardConfig> = [
  'apiBase',
  'apiKeyEnv',
  'apiKey',
  'provider',
  'model',
  'reasoningEffort',
  'fallbackProvider',
  'fallbackModel',
  'timeoutMs',
  'lowRiskTtlDays',
  'mediumRiskTtlDays',
  'onTimeout',
  'headlessMode',
  'notifyCacheHit',
  'notifyLlmDecision',
  'notifyAllow',
  'notifyDeny',
  'notifyAsk',
  'fileTrackerDefault',
  'fileTrackerWindowSec',
  'sessionCacheSize',
  'alwaysReviewCacheTtlMinutes',
  'examineEnabled',
  'auditPassword',
  'historyEnabled',
  'autoAnalyzeEnabled',
  'historyDays',
  'historyMinTotal',
  'historyMinLlm',
  'learnedCacheableMinTotal',
  'analyzeIntervalDays',
]

/** Minimal schemastery-shaped builder so no SDK import is needed at runtime. */
function field(defaultValue: unknown, role?: 'secret') {
  const node: Record<string, unknown> = { type: typeof defaultValue === 'boolean' ? 'boolean' : typeof defaultValue === 'number' ? 'number' : typeof defaultValue === 'object' && defaultValue !== null ? 'union' : 'string' }
  if (role) node.role = role
  node.default = defaultValue
  if (node.type === 'union') {
    node.choices = defaultValue
    node.default = undefined
  }
  if (defaultValue !== null && typeof defaultValue === 'object' && node.type === 'union') node.type = 'union'
  return node
}

function union(choices: readonly string[], defaultValue: string) {
  return { type: 'union', choices, default: defaultValue }
}

/** DSH settings schema for the `auto-guard` namespace (schemastery-shaped). */
export const GUARD_SETTINGS_SCHEMA = {
  type: 'object',
  default: {},
  keys: {
    apiBase: field(''),
    apiKeyEnv: field('DEEPSEEK_API_KEY'),
    apiKey: field('', 'secret'),
    apiKeyMasked: field(''),
    provider: field('deepseek-official'),
    model: field('deepseek-v4-flash'),
    reasoningEffort: field('off'),
    fallbackProvider: field('deepseek-official'),
    fallbackModel: field('deepseek-v4-flash'),
    timeoutMs: field(15000),
    lowRiskTtlDays: field(30),
    mediumRiskTtlDays: field(7),
    onTimeout: union(['deny', 'ask'], 'deny'),
    headlessMode: union(['deny', 'allow'], 'deny'),
    notifyCacheHit: field(true),
    notifyLlmDecision: field(true),
    notifyAllow: union(['page', 'context', 'off'], 'page'),
    notifyDeny: union(['page', 'context', 'off'], 'context'),
    notifyAsk: union(['page', 'context', 'off'], 'context'),
    fileTrackerDefault: union(['ask', 'deny'], 'ask'),
    fileTrackerWindowSec: field(5),
    sessionCacheSize: field(256),
    alwaysReviewCacheTtlMinutes: field(30),
    examineEnabled: field(false),
    auditPassword: field('', 'secret'),
    auditPasswordMasked: field(''),
    historyEnabled: field(false),
    autoAnalyzeEnabled: field(false),
    historyDays: field(60),
    historyMinTotal: field(4),
    historyMinLlm: field(1),
    learnedCacheableMinTotal: field(8),
    analyzeIntervalDays: field(15),
    configMigrated: field(false),
  },
}

/** True when a legacy private config file exists on disk. */
export function hasLegacyConfig(userPath: string = DEFAULT_CONFIG_PATH): boolean {
  return existsSync(userPath)
}

/**
 * Load config from `userPath` (default `~/.dsh/auto-guard/config.json`).
 *
 * `patch` is the static config supplied by `cordis.patch.yml`; it seeds a
 * missing config file and fills fields absent from an existing file. Once a
 * field is written to the config file it wins on later loads, so runtime
 * setting-page updates can persist changes in fallback mode.
 */
export function loadConfig(userPath: string = DEFAULT_CONFIG_PATH, patch: Partial<GuardConfig> = {}): GuardConfig {
  const seeded = { ...DEFAULT_CONFIG, ...patch }
  if (!existsSync(userPath)) {
    mkdirSync(dirname(userPath), { recursive: true })
    writeFileSync(userPath, `${JSON.stringify(seeded, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { ...seeded }
  }
  const raw = readFileSync(userPath, 'utf8')
  const stored = JSON.parse(raw) as Partial<GuardConfig>
  let changed = false
  for (const key of CONFIG_KEYS) {
    if (stored[key] === undefined) {
      ;(stored as Record<string, unknown>)[key] = seeded[key]
      changed = true
    }
  }
  const config = stored as GuardConfig
  const masked = maskApiKey(config.apiKey ?? '')
  if (config.apiKeyMasked !== masked) {
    config.apiKeyMasked = masked
    changed = true
  }
  const auditMasked = maskSecret(config.auditPassword ?? '')
  if (config.auditPasswordMasked !== auditMasked) {
    config.auditPasswordMasked = auditMasked
    changed = true
  }
  if (changed) saveConfig(config, userPath)
  return config
}

/** Persist config to `userPath` (default `~/.dsh/auto-guard/config.json`). */
export function saveConfig(config: GuardConfig, userPath: string = DEFAULT_CONFIG_PATH): void {
  mkdirSync(dirname(userPath), { recursive: true })
  const next: Record<string, unknown> = {}
  for (const key of CONFIG_KEYS) next[key] = config[key]
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8' })
}

/** Build the migration patch from a legacy config, skipping values equal to defaults. */
function legacyMigrationPatch(legacy: GuardConfig): Partial<GuardConfig> {
  const patch: Record<string, unknown> = { configMigrated: true }
  for (const key of USER_CONFIG_KEYS) {
    const value = legacy[key]
    if (value !== DEFAULT_CONFIG[key]) patch[key] = value
  }
  if (legacy.apiKey) patch.apiKeyMasked = maskApiKey(legacy.apiKey)
  if (legacy.auditPassword) patch.auditPasswordMasked = maskSecret(legacy.auditPassword)
  return patch as Partial<GuardConfig>
}

/**
 * Wire the DSH settings namespace into a mutable runtime config object.
 *
 * When the settings service is available this registers `auto-guard`, imports
 * legacy config values once, and keeps `config` updated from the resolved
 * scope. When it is unavailable the handle stays in fallback mode and callers
 * should keep using `saveConfig`.
 */
export function installGuardSettings(
  ctx: Context,
  config: GuardConfig,
  patchConfig: Partial<GuardConfig> = {},
  legacyPath: string = DEFAULT_CONFIG_PATH,
  onAuditPasswordChange?: (newPassword: string) => void,
): {
  available: boolean
  get(): GuardConfig
  update(patch: Partial<GuardConfig>): Promise<void>
  syncFromSettings(): void
} {
  let available = false
  let scope: { get(): Record<string, unknown>; update(patch: Record<string, unknown>): Promise<void>; watch(listener: () => void): () => void } | undefined
  let migrated = false
  let lastAuditPassword = config.auditPassword ?? ''

  const handle = {
    get available() {
      return available
    },
    get(): GuardConfig {
      return scope ? (scope.get() as unknown as GuardConfig) : config
    },
    async update(patch: Partial<GuardConfig>): Promise<void> {
      if (!scope) {
        const nextPassword = 'auditPassword' in patch ? (patch.auditPassword ?? '') : (config.auditPassword ?? '')
        Object.assign(config, patch)
        if ('apiKey' in patch) config.apiKeyMasked = maskApiKey(patch.apiKey ?? '')
        if ('auditPassword' in patch) config.auditPasswordMasked = maskSecret(patch.auditPassword ?? '')
        if (onAuditPasswordChange && nextPassword !== lastAuditPassword) {
          onAuditPasswordChange(nextPassword)
          lastAuditPassword = nextPassword
        }
        saveConfig(config, legacyPath)
        return
      }
      const next = { ...patch }
      if ('apiKey' in next) next.apiKeyMasked = maskApiKey(next.apiKey ?? '')
      if ('auditPassword' in next) next.auditPasswordMasked = maskSecret(next.auditPassword ?? '')
      await scope.update(next as unknown as Record<string, unknown>)
      handle.syncFromSettings()
    },
    syncFromSettings(): void {
      if (!scope) return
      Object.assign(config, scope.get())
      const auditPassword = config.auditPassword ?? ''
      if (onAuditPasswordChange && auditPassword !== lastAuditPassword) {
        onAuditPasswordChange(auditPassword)
        lastAuditPassword = auditPassword
      }
      const masked = maskApiKey(config.apiKey ?? '')
      if (config.apiKeyMasked !== masked) {
        config.apiKeyMasked = masked
        void scope.update({ apiKeyMasked: masked }).catch(() => {
          // Best-effort sync; the next settings watch will retry.
        })
      }
      const auditMasked = maskSecret(config.auditPassword ?? '')
      if (config.auditPasswordMasked !== auditMasked) {
        config.auditPasswordMasked = auditMasked
        void scope.update({ auditPasswordMasked: auditMasked }).catch(() => {
          // Best-effort sync; the next settings watch will retry.
        })
      }
    },
  }

  ;(ctx as unknown as { inject(deps: string[], callback: (sctx: unknown) => void): void }).inject(['settings'], (raw) => {
    const sctx = raw as {
      settings: {
        register(ns: unknown, schema: unknown, options: unknown): NonNullable<typeof scope>
        describe(options: { redactSecrets: boolean }): Array<{ ns: unknown; user?: Record<string, unknown> }>
      }
    }
    const ns = GUARD_SETTINGS_NAMESPACE
    const entry = { ...DEFAULT_CONFIG, ...patchConfig }
    const registered = sctx.settings.register(ns, GUARD_SETTINGS_SCHEMA, { base: entry })
    scope = registered
    available = true

    // One-time migration from the legacy private config into the user settings layer.
    if (!migrated && hasLegacyConfig(legacyPath)) {
      migrated = true
      const descriptor = sctx.settings.describe({ redactSecrets: true }).find((d) => d.ns === ns)
      const user = descriptor?.user as Record<string, unknown> | undefined
      if (!user || Object.keys(user).length === 0) {
        const legacy = loadConfig(legacyPath)
        const patch = legacyMigrationPatch(legacy)
        void registered.update(patch).catch(() => {
          // Migration is best-effort; keep running on the composition/base values.
        })
      }
    }

    handle.syncFromSettings()
    registered.watch(() => {
      handle.syncFromSettings()
    })
  })

  return handle
}
