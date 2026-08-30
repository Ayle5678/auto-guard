import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTrackerStore,
  DeepSeekReviewer,
  DiskSessionCache,
  FileTracker,
  loadRules,
  PersistentCache,
  SessionLruCache,
  defaultGuardConfig,
  type GuardConfig,
} from '@auto-guard/core'
import { buildGuardDeps } from '../src/index.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-rt-deps-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function config(root: string): GuardConfig {
  const config = defaultGuardConfig(root)
  config.apiKey = 'sk-test'
  return config
}

describe('buildGuardDeps: the one GuardDeps assembly (ADR-0016)', () => {
  it('wires the shared learned-rule/template-cache chain and the deps literal', () => {
    const root = tmp()
    const c = config(root)
    const rules = loadRules(c.rulesPath, c.defaultRulesPath)
    const templateStore = join(root, 'templates')
    const wiring = buildGuardDeps({
      config: { ...c, templateCachePath: templateStore },
      rules,
      lang: 'zh',
      sessionCache: new SessionLruCache(c.sessionCacheSize),
      persistentCache: new PersistentCache(c.cachePath),
      llmReviewer: new DeepSeekReviewer(c, 'zh'),
      fileTracker: new FileTracker(c.fileTrackerWindowSec * 1000),
    })
    expect(wiring.deps.lang).toBe('zh')
    expect(wiring.deps.templateCache).toBe(wiring.templateCache)
    expect(wiring.deps.historyStore).toBeUndefined()
    expect(wiring.deps.pendingPersistence).toBeUndefined()
    // Learned rules load from the host's learned-rules.json (empty until the
    // analyzer writes one) and seed the template cache's cacheable set.
    expect(Array.isArray(wiring.learned.cacheable)).toBe(true)
    expect(wiring.templateCache).toBeDefined()
  })

  it('accepts a disk session cache and pending sinks for the hook hosts', () => {
    const root = tmp()
    const c = config(root)
    const rules = loadRules(c.rulesPath, c.defaultRulesPath)
    const sessionDir = join(root, 'sessions', 's0')
    const trackerStore = createTrackerStore(sessionDir, c.fileTrackerWindowSec * 1000)
    const wiring = buildGuardDeps({
      config: c,
      rules,
      lang: 'en',
      sessionCache: new DiskSessionCache(sessionDir, c.sessionCacheSize),
      persistentCache: new PersistentCache(c.cachePath),
      llmReviewer: new DeepSeekReviewer(c, 'en'),
      fileTracker: new FileTracker(c.fileTrackerWindowSec * 1000, trackerStore),
    })
    expect(wiring.deps.lang).toBe('en')
  })
})
