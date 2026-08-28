import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore as AuditStore } from '../src/audit.ts'
import { emptyLearnedRules, generateLearnedRules, loadLearnedRules, writeLearnedRules } from '../src/learned-rules.ts'
import type { Decision } from '../src/types.ts'

const dirs: string[] = []
const stores: AuditStore[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pi-guard-learned-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (stores.length) stores.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function seed(dbPath: string, commands: string[], decision: Decision) {
  const audit = new AuditStore(dbPath)
  stores.push(audit)
  for (const command of commands) {
    audit.insert({
      source: 'tool_call',
      tool: 'bash',
      command,
      decision,
      finalAction: 'allow',
    })
  }
  return audit
}

const options = {
  days: 60,
  cacheableMinTotal: 8,
  cacheableMinLlm: 1,
  sensitivePaths: ['.env', '.ssh/'],
  excludedRules: [],
}

describe('generateLearnedRules', () => {
  it('generates cacheable templates for complex repeated commands', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python -m pytest energy_schedule/test_${i}.py -q`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable.some((r) => r.pattern === 'python -m pytest * -q')).toBe(true)
  })

  it('does not generate cacheable for bare python <path> commands', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python script_${i}.py`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable).toHaveLength(0)
  })

  it('does not generate cacheable for read-only file commands (cat *)', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `cat file_${i}.txt`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable).toHaveLength(0)
  })

  it('does not generate cacheable for PowerShell read-only cmdlets', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `Get-Content file_${i}.txt`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable).toHaveLength(0)
  })

  it('does not generate cacheable when a compound contains an excluded subcommand', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python -m pytest file_${i}.py -q && bash setup.sh`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), { ...options, excludedRules: [{ pattern: 'bash *', reason: 'excluded' }] })
    expect(rules.cacheable).toHaveLength(0)
  })

  it('renders --flag=value placeholders as wildcard patterns', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python run_pipeline --days=${i + 1}`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable.some((r) => r.pattern === 'python run_pipeline --days=*')).toBe(true)
  })

  it('does not generate cacheable for commands matching excluded rules', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python -m pytest energy_schedule/test_${i}.py -q`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' })
    const rules = generateLearnedRules(audit.list(), { ...options, excludedRules: [{ pattern: 'python *', reason: 'excluded' }] })
    expect(rules.cacheable).toHaveLength(0)
  })

  it('excludes rows with risk=null', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const commands = Array.from({ length: 8 }, (_, i) => `python -m pytest energy_schedule/test_${i}.py -q`)
    const audit = seed(dbPath, commands, { kind: 'allow', source: 'llm', reason: 'no risk' } as Decision)
    const rules = generateLearnedRules(audit.list(), options)
    expect(rules.cacheable).toHaveLength(0)
  })

  it('dedupes patterns that normalize to the same rule', () => {
    const dir = tmp()
    const dbPath = join(dir, 'audit.db')
    const audit = new AuditStore(dbPath)
    stores.push(audit)
    const commands = [
      ...Array.from({ length: 8 }, (_, i) => `python -m pytest file_${i}.py -q`),
      ...Array.from({ length: 8 }, (_, i) => `python -m pytest a_${i}.py b_${i}.py -q`),
    ]
    for (const command of commands) {
      audit.insert({
        source: 'tool_call',
        tool: 'bash',
        command,
        decision: { kind: 'allow', source: 'llm', risk: 'low', reason: 'ok' },
        finalAction: 'allow',
      })
    }
    const rules = generateLearnedRules(audit.list(), options)
    const patterns = rules.cacheable.map((r) => r.pattern)
    expect(patterns.filter((p) => p === 'python -m pytest * -q')).toHaveLength(1)
  })
})

describe('learned rules file', () => {
  it('loads empty rules when the file is missing', () => {
    expect(loadLearnedRules(join(tmp(), 'missing.json'))).toEqual(emptyLearnedRules())
  })

  it('ignores legacy staticAllow/staticAllowGuards and dedupes cacheable', () => {
    const dir = tmp()
    const path = join(dir, 'learned.json')
    writeFileSync(path, JSON.stringify({
      version: 1,
      staticAllow: [{ pattern: 'grep *', reason: 'old' }],
      staticAllowGuards: [{ when: 'grep *', flags: ['-r'] }],
      cacheable: [
        { pattern: 'python -m pytest * -q', reason: 'a' },
        { pattern: 'python -m pytest * -q', reason: 'b' },
        { pattern: 'npm run build', reason: 'c' },
      ],
    }), 'utf8')
    const rules = loadLearnedRules(path)
    expect(rules.cacheable).toEqual([
      { pattern: 'python -m pytest * -q', reason: 'a' },
      { pattern: 'npm run build', reason: 'c' },
    ])
    expect('staticAllow' in rules).toBe(false)
    expect('staticAllowGuards' in rules).toBe(false)
  })

  it('filters malformed, blacklisted, and excluded cacheable entries on load', () => {
    const dir = tmp()
    const path = join(dir, 'learned.json')
    writeFileSync(path, JSON.stringify({
      version: 1,
      cacheable: [
        {},
        'bad',
        { pattern: 'Get-Content *', reason: 'old' },
        { pattern: 'npm run build', reason: 'ok' },
        { pattern: 'python -m pytest * -q', reason: 'py' },
      ],
    }), 'utf8')
    const rules = loadLearnedRules(path, [{ pattern: 'python *', reason: 'excluded' }])
    expect(rules.cacheable).toEqual([{ pattern: 'npm run build', reason: 'ok' }])
  })

  it('writes a backup before overwriting', () => {
    const dir = tmp()
    const path = join(dir, 'learned.json')
    const backup = join(dir, 'learned.backup.json')
    writeLearnedRules(path, backup, { version: 1, cacheable: [{ pattern: 'python *', reason: 'old' }] })
    writeLearnedRules(path, backup, { version: 1, cacheable: [{ pattern: 'npm run build', reason: 'new' }] })
    expect(loadLearnedRules(backup).cacheable[0].pattern).toBe('python *')
    expect(loadLearnedRules(path).cacheable[0].pattern).toBe('npm run build')
  })
})
