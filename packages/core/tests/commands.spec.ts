import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeLearnedRules,
  applyHistoryToggle,
  applySetApi,
  examineStatusLines,
  maskKey,
  optimizeListLines,
  optimizeStatusLines,
  recentLines,
  reportLines,
  rollbackLearnedRules,
  setEnabled,
  statusLines,
} from '../src/commands.ts'
import { defaultGuardConfig } from '../src/config.ts'
import { effectiveNotifyRoute, usesFourStateAsk, type HostCapabilities } from '../src/host-capabilities.ts'

// Per ADR-0007 these declarations belong to the adapters; duplicated here as data for contract tests.
const PI_CAPABILITIES: HostCapabilities = { askStyle: 'four-state', headlessFallback: 'deny', hasUI: true, notifyChannels: { page: true, context: true }, userBash: true, sessionState: 'memory' }
const DSH_CAPABILITIES: HostCapabilities = { askStyle: 'one-shot', headlessFallback: 'deny', hasUI: true, notifyChannels: { page: true, context: true }, userBash: false, sessionState: 'memory' }
const ZCODE_CAPABILITIES: HostCapabilities = { askStyle: 'native', headlessFallback: 'host', hasUI: false, notifyChannels: { page: false, context: false }, userBash: false, sessionState: 'disk' }
import { LightAuditStore } from '../src/audit.ts'
import type { AuditWindowSummary } from '../src/audit.ts'
import { emptyLearnedRules, writeLearnedRules } from '../src/learned-rules.ts'
import type { RuntimeStatus } from '../src/decision-history.ts'
import type { GuardConfig, RulesFile } from '../src/types.ts'

function makeConfig(): GuardConfig {
  return defaultGuardConfig(mkdtempSync(join(tmpdir(), 'ag-cmds-')))
}

function makeRules(): RulesFile {
  return {
    version: 1,
    staticAllow: [],
    hardDeny: [],
    directoryDelete: [],
    directoryDeleteGuards: [],
    userConfirmed: [],
    cacheable: [],
    alwaysReview: [],
    staticAllowGuards: [],
    sensitivePaths: [],
  }
}

describe('commands: guard group', () => {
  it('on/off flips enabled and reports in product wording', () => {
    const config = makeConfig()
    expect(setEnabled(config, true)).toContain('守卫已启用')
    expect(config.enabled).toBe(true)
    expect(setEnabled(config, false)).toContain('守卫已停用')
    expect(config.enabled).toBe(false)
  })

  it('status lines show switch, endpoint and last decision', () => {
    const config = makeConfig()
    config.apiKey = 'sk-test'
    const status: RuntimeStatus = {
      lastRunAt: new Date(2026, 7, 28, 9, 0, 0).toISOString(),
      lastTool: 'Bash',
      lastCommand: 'npm test',
      lastDecisionKind: 'allow',
      lastDecisionSource: 'llm',
      reviewerLastFailed: true,
    }
    const lines = statusLines(config, status, '/cfg/config.json')
    const joined = lines.join('\n')
    expect(joined).toContain('enabled : true')
    expect(joined).toContain('/cfg/config.json')
    expect(joined).toContain('[llm]')
    expect(joined).toContain('最近一次 LLM 审查失败')

    const noKey = statusLines({ ...config, apiKey: '' }, {}, '/cfg/config.json')
    expect(noKey.join('\n')).toContain('⚠ 无 API Key（fail-closed）')
  })

  it('recent lines render the pull-based decision history table', () => {
    const entries: RuntimeStatus[] = [
      { lastRunAt: new Date(2026, 7, 28, 9, 0, 0).toISOString(), lastTool: 'Bash', lastCommand: 'ls', lastDecisionKind: 'allow', lastDecisionSource: 'static-allow' },
    ]
    const lines = recentLines(entries, 10)
    expect(lines[0]).toContain('时间')
    expect(lines[1]).toContain('ls')
    expect(lines[1]).toContain('白名单')
    expect(recentLines([], 10)).toEqual(['(暂无裁决历史)'])
  })
})

describe('commands: set group', () => {
  it('masks keys without leaking the middle', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-a***mnop')
    expect(maskKey('short')).toBe('***')
  })

  it('set-api updates base/model, resets to defaults, rejects unknown forms', () => {
    const config = makeConfig()
    const defaults = defaultGuardConfig(join(tmpdir(), 'ag-unused'))
    const set = applySetApi(config, 'base', 'https://example.com', defaults)
    expect(set.ok).toBe(true)
    expect(config.apiBase).toBe('https://example.com')

    applySetApi(config, 'model', 'm2', defaults)
    expect(config.model).toBe('m2')

    applySetApi(config, 'reset', undefined, defaults)
    expect(config.apiBase).toBe(defaults.apiBase)
    expect(config.model).toBe(defaults.model)

    expect(applySetApi(config, 'bogus', 'x', defaults).ok).toBe(false)
  })

  it('history toggle warns when the audit source is off', () => {
    const config = makeConfig()
    const on = applyHistoryToggle(config, 'on')
    expect(on.ok).toBe(true)
    expect(config.historyEnabled).toBe(true)
    expect(on.messages.some((m) => m.includes('examine 未开启'))).toBe(true)

    config.examineEnabled = true
    expect(applyHistoryToggle(config, 'on').messages).toHaveLength(1)
    expect(applyHistoryToggle(config, 'sometimes').ok).toBe(false)
  })
})

describe('commands: examine + optimize groups', () => {
  it('examine status lines expose switch and db path', () => {
    const config = makeConfig()
    const lines = examineStatusLines(config)
    expect(lines.join('\n')).toContain(`db: ${config.auditDbPath}`)
  })

  it('analyze refuses when examine is off, writes rules when on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-analyze-'))
    try {
      const config = makeConfig()
      const rules = makeRules()
      const audit = new LightAuditStore(join(dir, 'audit.db'))
      expect(analyzeLearnedRules({ config, rules, audit }).ok).toBe(false)

      config.examineEnabled = true
      const result = analyzeLearnedRules({ config, rules, audit })
      expect(result.ok).toBe(true)
      audit.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('optimize status/list/rollback operate on injected files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-optimize-'))
    try {
      const config = makeConfig()
      config.learnedRulesPath = join(dir, 'learned.json')
      config.learnedBackupPath = join(dir, 'learned.bak.json')
      // First write creates the file; the second one produces the backup copy.
      writeLearnedRules(config.learnedRulesPath, config.learnedBackupPath, emptyLearnedRules())
      writeLearnedRules(config.learnedRulesPath, config.learnedBackupPath, {
        version: 1,
        cacheable: [{ pattern: 'npm run build*', reason: 'learned' }],
      })

      const snapshot = optimizeStatusLines(config, { version: 1, cacheable: [{ pattern: 'npm run build*' }] })
      expect(snapshot.join('\n')).toContain('cacheable rules   : 1')

      expect(optimizeListLines({ version: 1, cacheable: [] })).toEqual(['(无学习规则)'])
      expect(optimizeListLines({ version: 1, cacheable: [{ pattern: 'p', reason: 'r' }] })).toEqual(['p', '  r'])
      expect(optimizeListLines({ version: 1, cacheable: [{ pattern: 'p' }] })).toEqual(['p'])

      const rolled = rollbackLearnedRules(config)
      expect(rolled.ok).toBe(true)
      expect(rollbackLearnedRules({ ...config, learnedBackupPath: join(dir, 'missing.bak') }).ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('host capabilities (ADR-0007)', () => {
  it('known hosts keep their documented shapes', () => {
    expect(PI_CAPABILITIES.askStyle).toBe('four-state')
    expect(PI_CAPABILITIES.sessionState).toBe('memory')
    expect(DSH_CAPABILITIES.askStyle).toBe('one-shot')
    expect(DSH_CAPABILITIES.userBash).toBe(false)
    expect(ZCODE_CAPABILITIES.askStyle).toBe('native')
    expect(ZCODE_CAPABILITIES.headlessFallback).toBe('host')
    expect(ZCODE_CAPABILITIES.sessionState).toBe('disk')
    expect(ZCODE_CAPABILITIES.notifyChannels.page).toBe(false)
  })

  it('notify routes degrade to channels the host can deliver', () => {
    expect(effectiveNotifyRoute('page', PI_CAPABILITIES)).toBe('page')
    expect(effectiveNotifyRoute('page', ZCODE_CAPABILITIES)).toBe('off')
    expect(effectiveNotifyRoute('context', ZCODE_CAPABILITIES)).toBe('off')
    const pageOnly = { notifyChannels: { page: true, context: false } }
    expect(effectiveNotifyRoute('context', pageOnly)).toBe('page')
    expect(effectiveNotifyRoute('off', PI_CAPABILITIES)).toBe('off')
  })

  it('four-state ask memory wires only for four-state hosts', () => {
    expect(usesFourStateAsk(PI_CAPABILITIES)).toBe(true)
    expect(usesFourStateAsk(DSH_CAPABILITIES)).toBe(false)
    expect(usesFourStateAsk(ZCODE_CAPABILITIES)).toBe(false)
  })

  it('empty learned rules placeholder stays available for ops callers', () => {
    expect(emptyLearnedRules()).toEqual({ version: 1, cacheable: [] })
  })
})

describe('commands: reportLines', () => {
  const summary = (over: Partial<AuditWindowSummary> = {}): AuditWindowSummary => ({
    dbTotal: 561,
    total: 4,
    allow: 2,
    deny: 1,
    ask: 1,
    reviewerFailed: 1,
    bySource: [
      { source: 'llm', count: 3 },
      { source: 'static-allow', count: 1 },
    ],
    ...over,
  })

  it('renders the window header, kind counts, LLM line and per-source counts', () => {
    const lines = reportLines(summary(), 7)
    const text = lines.join('\n')
    expect(lines[0]).toContain('近 7 天')
    expect(lines[0]).toContain('561')
    expect(text).toContain('allow 2 · deny 1 · ask 1')
    expect(text).toContain('LLM 审查 3 次')
    expect(text).toContain('fail-closed 兜底 1 次')
    expect(text).toContain('白名单')
    // sources sorted by count descending: LLM line first, then per-source rows
    expect(text.indexOf('白名单')).toBeGreaterThan(text.indexOf('按来源'))
  })

  it('speaks English when asked', () => {
    const text = reportLines(summary(), 7, 'en').join('\n')
    expect(text).toContain('last 7 day(s)')
    expect(text).toContain('allow 2 · deny 1 · ask 1')
    expect(text).toContain('allowlist')
  })

  it('window with no rows renders the empty line with the all-time total', () => {
    const lines = reportLines(summary({ total: 0, allow: 0, deny: 0, ask: 0, reviewerFailed: 0, bySource: [] }), 7)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('近 7 天无审查记录')
    expect(lines[0]).toContain('561')
  })
})
