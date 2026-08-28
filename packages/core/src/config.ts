/**
 * Configuration loading and persistence for the auto-guard core.
 *
 * The config root is host-specific (each adapter passes its own directory,
 * each host keeps its own root, per ADR-0003); this module only owns the
 * superset defaults and the load/merge/save mechanics. On first run a config
 * is created with defaults; missing fields are filled from defaults and
 * written back, so older config files keep working as new options are added.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expandHome } from './command.ts'
import type { GuardConfig } from './types.ts'

/**
 * Build the default config for a host config root `dir`
 * (the host's auto-guard directory, already expanded).
 */
export function defaultGuardConfig(dir: string): GuardConfig {
  return {
    enabled: true,
    rulesPath: join(dir, 'rules.json'),
    defaultRulesPath: join(dir, 'defaults.json'),
    cachePath: join(dir, 'cache.json'),
    apiBase: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: '',
    model: 'deepseek-v4-flash',
    fallbackModel: 'deepseek-v4-flash',
    timeoutMs: 8000,
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
    auditDbPath: join(dir, 'audit.db'),
    historyEnabled: false,
    autoAnalyzeEnabled: false,
    historyDays: 60,
    historyMinTotal: 4,
    historyMinLlm: 1,
    learnedCacheableMinTotal: 4,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    learnedRulesPath: join(dir, 'learned-rules.json'),
    learnedBackupPath: join(dir, 'learned-rules.backup.json'),
    analyzeStatePath: join(dir, 'analyze-state.json'),
    templateCachePath: join(dir, 'template-cache.json'),
  }
}

const CONFIG_KEYS: Array<keyof GuardConfig> = [
  'enabled',
  'lang',
  'rulesPath',
  'defaultRulesPath',
  'cachePath',
  'apiBase',
  'apiKeyEnv',
  'apiKey',
  'apiKeyMasked',
  'provider',
  'reasoningEffort',
  'model',
  'fallbackModel',
  'fallbackProvider',
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
  'configMigrated',
  'historyEnabled',
  'autoAnalyzeEnabled',
  'historyDays',
  'historyMinTotal',
  'historyMinLlm',
  'learnedCacheableMinTotal',
  'analyzeIntervalMinutes',
  'analyzeIntervalDays',
  'analyzeRowLimit',
  'learnedRulesPath',
  'learnedBackupPath',
  'analyzeStatePath',
  'templateCachePath',
]

/**
 * Load config from `userPath`, filling missing fields from `defaults`
 * and writing back when anything changed.
 */
export function loadConfig(userPath: string, defaults: GuardConfig): GuardConfig {
  if (!existsSync(userPath)) {
    mkdirSync(dirname(userPath), { recursive: true })
    writeFileSync(userPath, `${JSON.stringify(defaults, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { ...defaults }
  }
  const raw = readFileSync(userPath, 'utf8')
  const stored = JSON.parse(raw) as Partial<GuardConfig>
  let changed = false
  for (const key of CONFIG_KEYS) {
    // Optional keys with no default (lang, masked display values) stay unset
    // when absent — "not set" is meaningful for the four-layer resolution.
    if (stored[key] === undefined && defaults[key] !== undefined) {
      ;(stored as Record<string, unknown>)[key] = defaults[key]
      changed = true
    }
  }
  if (changed) saveConfig(stored as GuardConfig, userPath)
  return stored as GuardConfig
}

/** Persist config to `userPath`. */
export function saveConfig(config: GuardConfig, userPath: string): void {
  mkdirSync(dirname(userPath), { recursive: true })
  const next: Record<string, unknown> = {}
  for (const key of CONFIG_KEYS) next[key] = config[key]
  writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8' })
}
