/**
 * ZCode built-in management CLI language surface (ticket 03): under an
 * English config every group's output switches to English, `set lang`
 * persists and receipts in the new language. The config root is mocked into
 * a temp dir; stdout is captured through a spy.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GuardConfig } from '@auto-guard/core'

const dir = mkdtempSync(join(tmpdir(), 'ag-zc-cli-'))
const saved: GuardConfig[] = []

vi.mock('../src/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.ts')>()
  return {
    ...actual,
    get AUTO_GUARD_DIR() {
      return dir
    },
    get DEFAULT_CONFIG_PATH() {
      return join(dir, 'config.json')
    },
    defaultConfig: () => baseConfig(),
    loadConfig: () => ({ ...baseConfig() }),
    saveConfig: (config: GuardConfig) => saved.push(config),
  }
})

function baseConfig(): GuardConfig {
  return {
    enabled: true,
    lang: 'en',
    rulesPath: join(dir, 'rules.json'),
    defaultRulesPath: join(dir, 'defaults.json'),
    cachePath: join(dir, 'cache.json'),
    apiBase: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKey: '',
    model: 'm',
    fallbackModel: 'm',
    timeoutMs: 3000,
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
    learnedCacheableMinTotal: 8,
    analyzeIntervalMinutes: 20,
    analyzeIntervalDays: 15,
    analyzeRowLimit: 5000,
    templateCachePath: join(dir, 'template-cache.json'),
    learnedRulesPath: join(dir, 'learned-rules.json'),
    learnedBackupPath: join(dir, 'learned-rules.backup.json'),
    analyzeStatePath: join(dir, 'analyze-state.json'),
  }
}

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Handles may still be open on Windows; the temp dir sweeper will take it.
  }
})

async function capture(argv: readonly string[]): Promise<string> {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stdout.write)
  try {
    const { main } = await import('../src/cli.ts')
    await main(argv)
  } finally {
    spy.mockRestore()
  }
  return chunks.join('')
}

describe('zcode cli: English golden paths', () => {
  it('guard status renders in English with the effective-language line', async () => {
    const out = await capture(['guard', 'status'])
    expect(out).toContain('lang    : en')
    expect(out).toContain('no API Key (fail-closed)')
  })

  it('guard usage and group receipts switch to English', async () => {
    expect(await capture(['guard', 'bogus'])).toContain('Usage: node dist/cli.js guard')
    expect(await capture(['examine', 'on'])).toContain('Audit log enabled')
    expect(await capture(['optimize', 'bogus'])).toContain('Usage: node dist/cli.js optimize')
    // The top-level usage prints before any config load: pin the language
    // through the env layer for this one assertion.
    process.env.AUTO_GUARD_LANG = 'en'
    try {
      const top = await capture(['nothing'])
      expect(top).toContain('Usage: node dist/cli.js <guard|set|examine|optimize>')
    } finally {
      delete process.env.AUTO_GUARD_LANG
    }
  })

  it('set show-key renders the three layers in English', async () => {
    const out = await capture(['set', 'show-key'])
    expect(out).toContain('not set')
    expect(out).toContain('(not stored)')
    expect(out).toContain('(none)')
  })

  it('set lang persists and receipts in the new language', async () => {
    const out = await capture(['set', 'lang', 'zh'])
    expect(out).toContain('语言已设置：zh')
    expect(saved.at(-1)?.lang).toBe('zh')
  })

  it('set lang rejects unknown values listing the available ones', async () => {
    const out = await capture(['set', 'lang', 'fr'])
    expect(out).toContain('Invalid language value: fr')
    expect(out).toContain('zh, en')
  })
})
