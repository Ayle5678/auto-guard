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
import { defaultGuardConfig, expandHome } from '@auto-guard/core'
import type { Context } from '@deepseek-ai/cordis'
import type { GuardConfig } from '@auto-guard/core'

export const AUTO_GUARD_DIR = join(expandHome('~'), '.dsh', 'auto-guard')
export const DEFAULT_CONFIG_PATH = join(AUTO_GUARD_DIR, 'config.json')
/** Opaque namespace token handed to the DSH settings service. */
export const GUARD_SETTINGS_NAMESPACE = { ns: 'auto-guard' }

/**
 * DSH defaults as a declarative delta over the core defaults (ADR-0024): the
 * base comes from `defaultGuardConfig`, every overridden or added line
 * carries its intentional-divergence reason, and current values are
 * unchanged. `enabled` keeps the core default — on DSH the permission
 * preset is the only real switch and `enabled` is never persisted.
 */
export const DEFAULT_CONFIG: GuardConfig = {
  ...defaultGuardConfig(AUTO_GUARD_DIR),
  // Intentional divergence: no direct endpoint — reviews ride the injected
  // ctx.llm provider route; a direct apiBase is opt-in.
  apiBase: '',
  // DSH-only provider routing (the core config has no provider fields).
  provider: 'deepseek-official',
  reasoningEffort: 'off',
  fallbackProvider: 'deepseek-official',
  // Intentional divergence: longer budget — the provider route has higher
  // tail latency than a direct API call.
  timeoutMs: 15000,
  // Intentional divergence: higher learning bar — DSH sessions are
  // long-lived, so learning demands more evidence before caching a rule.
  learnedCacheableMinTotal: 8,
  // Intentional divergence: auto-analysis cadence off (0 disables it);
  // analysis runs via the settings page's explicit button.
  analyzeIntervalMinutes: 0,
  // DSH-only masked-display and audit-secret fields (core leaves them unset).
  apiKeyMasked: '',
  auditPassword: '',
  auditPasswordMasked: '',
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

/**
 * The single field specification every DSH key list derives from (ADR-0024):
 * the legacy-file persistence list, the user-facing settings keys and the
 * settings-page schema. Row order is the order of all three derived lists;
 * `schema: false` marks file-only internals, `user: false` marks fields the
 * settings page shows but the user cannot meaningfully set. Adding a
 * GuardConfig field means adding one row here, not three mirrored lists.
 */
interface FieldSpec {
  key: keyof GuardConfig
  node: Record<string, unknown>
  schema?: false
  user?: false
}

const FIELDS: readonly FieldSpec[] = [
  { key: 'rulesPath', node: field(DEFAULT_CONFIG.rulesPath), schema: false, user: false },
  { key: 'defaultRulesPath', node: field(DEFAULT_CONFIG.defaultRulesPath), schema: false, user: false },
  { key: 'cachePath', node: field(DEFAULT_CONFIG.cachePath), schema: false, user: false },
  { key: 'apiBase', node: field(DEFAULT_CONFIG.apiBase) },
  { key: 'apiKeyEnv', node: field(DEFAULT_CONFIG.apiKeyEnv) },
  { key: 'apiKey', node: field(DEFAULT_CONFIG.apiKey, 'secret') },
  { key: 'apiKeyMasked', node: field(DEFAULT_CONFIG.apiKeyMasked), user: false },
  { key: 'provider', node: field(DEFAULT_CONFIG.provider) },
  { key: 'model', node: field(DEFAULT_CONFIG.model) },
  { key: 'reasoningEffort', node: field(DEFAULT_CONFIG.reasoningEffort) },
  { key: 'fallbackProvider', node: field(DEFAULT_CONFIG.fallbackProvider) },
  { key: 'fallbackModel', node: field(DEFAULT_CONFIG.fallbackModel) },
  { key: 'timeoutMs', node: field(DEFAULT_CONFIG.timeoutMs) },
  { key: 'lowRiskTtlDays', node: field(DEFAULT_CONFIG.lowRiskTtlDays) },
  { key: 'mediumRiskTtlDays', node: field(DEFAULT_CONFIG.mediumRiskTtlDays) },
  { key: 'onTimeout', node: union(['deny', 'ask'], DEFAULT_CONFIG.onTimeout) },
  { key: 'headlessMode', node: union(['deny', 'allow'], DEFAULT_CONFIG.headlessMode) },
  { key: 'notifyCacheHit', node: field(DEFAULT_CONFIG.notifyCacheHit) },
  { key: 'notifyLlmDecision', node: field(DEFAULT_CONFIG.notifyLlmDecision) },
  { key: 'notifyAllow', node: union(['page', 'context', 'off'], DEFAULT_CONFIG.notifyAllow) },
  { key: 'notifyDeny', node: union(['page', 'context', 'off'], DEFAULT_CONFIG.notifyDeny) },
  { key: 'notifyAsk', node: union(['page', 'context', 'off'], DEFAULT_CONFIG.notifyAsk) },
  { key: 'fileTrackerDefault', node: union(['ask', 'deny'], DEFAULT_CONFIG.fileTrackerDefault) },
  { key: 'fileTrackerWindowSec', node: field(DEFAULT_CONFIG.fileTrackerWindowSec) },
  { key: 'sessionCacheSize', node: field(DEFAULT_CONFIG.sessionCacheSize) },
  { key: 'alwaysReviewCacheTtlMinutes', node: field(DEFAULT_CONFIG.alwaysReviewCacheTtlMinutes) },
  { key: 'examineEnabled', node: field(DEFAULT_CONFIG.examineEnabled) },
  { key: 'auditDbPath', node: field(DEFAULT_CONFIG.auditDbPath), schema: false, user: false },
  { key: 'auditPassword', node: field(DEFAULT_CONFIG.auditPassword, 'secret') },
  { key: 'auditPasswordMasked', node: field(DEFAULT_CONFIG.auditPasswordMasked), user: false },
  { key: 'historyEnabled', node: field(DEFAULT_CONFIG.historyEnabled) },
  { key: 'autoAnalyzeEnabled', node: field(DEFAULT_CONFIG.autoAnalyzeEnabled) },
  { key: 'historyDays', node: field(DEFAULT_CONFIG.historyDays) },
  { key: 'historyMinTotal', node: field(DEFAULT_CONFIG.historyMinTotal) },
  { key: 'historyMinLlm', node: field(DEFAULT_CONFIG.historyMinLlm) },
  { key: 'learnedCacheableMinTotal', node: field(DEFAULT_CONFIG.learnedCacheableMinTotal) },
  { key: 'analyzeIntervalMinutes', node: field(DEFAULT_CONFIG.analyzeIntervalMinutes), schema: false, user: false },
  { key: 'analyzeIntervalDays', node: field(DEFAULT_CONFIG.analyzeIntervalDays) },
  { key: 'analyzeRowLimit', node: field(DEFAULT_CONFIG.analyzeRowLimit), schema: false, user: false },
  { key: 'templateCachePath', node: field(DEFAULT_CONFIG.templateCachePath), schema: false, user: false },
  { key: 'learnedRulesPath', node: field(DEFAULT_CONFIG.learnedRulesPath), schema: false, user: false },
  { key: 'learnedBackupPath', node: field(DEFAULT_CONFIG.learnedBackupPath), schema: false, user: false },
  { key: 'analyzeStatePath', node: field(DEFAULT_CONFIG.analyzeStatePath), schema: false, user: false },
  { key: 'configMigrated', node: field(false), user: false },
]

/** Legacy-file persistence list, derived from {@link FIELDS}. */
export const CONFIG_KEYS: Array<keyof GuardConfig> = FIELDS.map((f) => f.key)

/** User-facing settings keys: everything except internal file paths and the migration marker. */
export const USER_CONFIG_KEYS: Array<keyof GuardConfig> = FIELDS.filter((f) => f.user !== false).map((f) => f.key)

/** DSH settings schema for the `auto-guard` namespace (schemastery-shaped, derived from {@link FIELDS}). */
export const GUARD_SETTINGS_SCHEMA = {
  type: 'object',
  default: {},
  keys: Object.fromEntries(FIELDS.filter((f) => f.schema !== false).map((f) => [f.key, f.node])),
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
