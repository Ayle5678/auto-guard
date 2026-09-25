import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { expandHome } from '@auto-guard/core'
import { CONFIG_KEYS, DEFAULT_CONFIG, GUARD_SETTINGS_SCHEMA, USER_CONFIG_KEYS } from '../src/config.ts'

const AUTO_GUARD_DIR = join(expandHome('~'), '.dsh', 'auto-guard')

/**
 * The declarative delta (ADR-0024) must reproduce today's hand-mirrored
 * values byte for byte — this is the zero-change pin for the refactor.
 */
const PINNED_DEFAULTS = {
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
  sessionCacheSize: 300,
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

const PINNED_CONFIG_KEYS = [
  'rulesPath', 'defaultRulesPath', 'cachePath', 'apiBase', 'apiKeyEnv', 'apiKey', 'apiKeyMasked',
  'provider', 'model', 'reasoningEffort', 'fallbackProvider', 'fallbackModel', 'timeoutMs',
  'lowRiskTtlDays', 'mediumRiskTtlDays', 'onTimeout', 'headlessMode', 'notifyCacheHit',
  'notifyLlmDecision', 'notifyAllow', 'notifyDeny', 'notifyAsk', 'fileTrackerDefault',
  'fileTrackerWindowSec', 'sessionCacheSize', 'alwaysReviewCacheTtlMinutes', 'examineEnabled',
  'auditDbPath', 'auditPassword', 'auditPasswordMasked', 'historyEnabled', 'autoAnalyzeEnabled',
  'historyDays', 'historyMinTotal', 'historyMinLlm', 'learnedCacheableMinTotal',
  'analyzeIntervalMinutes', 'analyzeIntervalDays', 'analyzeRowLimit', 'templateCachePath',
  'learnedRulesPath', 'learnedBackupPath', 'analyzeStatePath', 'configMigrated',
]

const PINNED_USER_KEYS = [
  'apiBase', 'apiKeyEnv', 'apiKey', 'provider', 'model', 'reasoningEffort', 'fallbackProvider',
  'fallbackModel', 'timeoutMs', 'lowRiskTtlDays', 'mediumRiskTtlDays', 'onTimeout', 'headlessMode',
  'notifyCacheHit', 'notifyLlmDecision', 'notifyAllow', 'notifyDeny', 'notifyAsk',
  'fileTrackerDefault', 'fileTrackerWindowSec', 'sessionCacheSize', 'alwaysReviewCacheTtlMinutes',
  'examineEnabled', 'auditPassword', 'historyEnabled', 'autoAnalyzeEnabled', 'historyDays',
  'historyMinTotal', 'historyMinLlm', 'learnedCacheableMinTotal', 'analyzeIntervalDays',
]

const PINNED_SCHEMA_KEYS = [
  'apiBase', 'apiKeyEnv', 'apiKey', 'apiKeyMasked', 'provider', 'model', 'reasoningEffort',
  'fallbackProvider', 'fallbackModel', 'timeoutMs', 'lowRiskTtlDays', 'mediumRiskTtlDays',
  'onTimeout', 'headlessMode', 'notifyCacheHit', 'notifyLlmDecision', 'notifyAllow', 'notifyDeny',
  'notifyAsk', 'fileTrackerDefault', 'fileTrackerWindowSec', 'sessionCacheSize',
  'alwaysReviewCacheTtlMinutes', 'examineEnabled', 'auditPassword', 'auditPasswordMasked',
  'historyEnabled', 'autoAnalyzeEnabled', 'historyDays', 'historyMinTotal', 'historyMinLlm',
  'learnedCacheableMinTotal', 'analyzeIntervalDays', 'configMigrated',
]

describe('DSH defaults: declarative delta (ADR-0024)', () => {
  it('reproduces the pre-refactor defaults value for value', () => {
    expect(DEFAULT_CONFIG).toEqual(PINNED_DEFAULTS)
  })

  it('derives the exact pre-refactor persistence key list (order included)', () => {
    expect(CONFIG_KEYS).toEqual(PINNED_CONFIG_KEYS)
  })

  it('derives the exact pre-refactor user-facing key list (order included)', () => {
    expect(USER_CONFIG_KEYS).toEqual(PINNED_USER_KEYS)
  })

  it('derives the exact pre-refactor settings-schema keys (order included)', () => {
    expect(Object.keys(GUARD_SETTINGS_SCHEMA.keys)).toEqual(PINNED_SCHEMA_KEYS)
  })

  it('keeps every schema node default in sync with DEFAULT_CONFIG', () => {
    for (const [key, node] of Object.entries(GUARD_SETTINGS_SCHEMA.keys)) {
      if (key === 'configMigrated') continue // not a DEFAULT_CONFIG field
      expect(node.default, key).toEqual((DEFAULT_CONFIG as unknown as Record<string, unknown>)[key])
    }
  })

  it('declares secret roles exactly for apiKey and auditPassword', () => {
    expect(Object.entries(GUARD_SETTINGS_SCHEMA.keys).filter(([, node]) => (node as { role?: string }).role === 'secret').map(([key]) => key)).toEqual(['apiKey', 'auditPassword'])
  })
})
