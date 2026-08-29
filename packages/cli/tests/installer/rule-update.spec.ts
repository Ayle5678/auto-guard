import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDefaults, type RulesFile } from '@auto-guard/core'
import { runCli } from '../../src/shell.ts'
import { applyRuleUpdate, buildRuleUpdatePlan } from '../../src/installer/rule-update.ts'
import { profileById, type HostId } from '../../src/installer/profiles.ts'
import type { InstallerDeps } from '../../src/installer/install.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-rule-update-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** The host's auto-guard config root, as declared by its profile. */
function rootOf(hostId: HostId): string {
  return profileById(hostId)!.configRoot
}

/** Shipped-defaults stand-in: stable content the tests control completely. */
function shippedFixture(): RulesFile {
  return {
    version: 1,
    staticAllow: [{ pattern: 'ls', reason: 'read-only listing' }],
    hardDeny: [{ pattern: 'rm -rf /', reason: 'root wipe' }],
    directoryDelete: [
      { pattern: 'rm -rf *', reason: 'Recursive delete' },
      { pattern: 'rm -r *', reason: 'Bare recursive delete' },
    ],
    directoryDeleteGuards: [],
    userConfirmed: [],
    cacheable: [],
    alwaysReview: [],
    staticAllowGuards: [],
    sensitivePaths: [],
  }
}

function writeRoot(home: string, hostId: HostId, defaults: unknown, rules: unknown): void {
  const root = join(home, rootOf(hostId))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'defaults.json'), `${JSON.stringify(defaults, null, 2)}\n`, 'utf8')
  writeFileSync(join(root, 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`, 'utf8')
}

function rootFile(home: string, hostId: HostId, file: string): string {
  return join(home, rootOf(hostId), file)
}

function readRoot(home: string, hostId: HostId, file: 'defaults.json' | 'rules.json'): RulesFile {
  return JSON.parse(readFileSync(rootFile(home, hostId, file), 'utf8')) as RulesFile
}

/** The pi local defaults miss `rm -r *` and carry one custom entry. */
function piLocalDefaults(shipped: RulesFile): RulesFile {
  return {
    ...shipped,
    staticAllow: [...shipped.staticAllow, { pattern: 'my-alias', reason: 'user custom' }],
    directoryDelete: shipped.directoryDelete.filter((rule) => rule.pattern !== 'rm -r *'),
  }
}

/** The pi local user rules miss `rm -r *` and `rm -rf *`, keep one custom entry. */
function piLocalRules(shipped: RulesFile): RulesFile {
  return {
    ...shipped,
    staticAllow: [{ pattern: 'my-own-allow', reason: 'user custom' }],
    directoryDelete: shipped.directoryDelete.filter((rule) => rule.pattern !== 'rm -r *' && rule.pattern !== 'rm -rf *'),
  }
}

describe('rule update: plan and apply (ticket 02)', () => {
  it('appends entries missing from each layer, dedupes present ones, preserves custom entries and order', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    writeRoot(home, 'pi', piLocalDefaults(shipped), piLocalRules(shipped))

    const plan = buildRuleUpdatePlan(home, { shipped })
    expect(plan.blocked).toEqual([])
    expect(plan.updates).toHaveLength(2)

    const outcome = applyRuleUpdate(plan.updates)
    expect(outcome.ok).toBe(true)

    const defaults = readRoot(home, 'pi', 'defaults.json')
    // Missing entry appended; present entry not duplicated; custom entry kept last.
    expect(defaults.directoryDelete.map((rule) => rule.pattern)).toEqual(['rm -rf *', 'rm -r *'])
    expect(defaults.staticAllow.map((rule) => rule.pattern)).toEqual(['ls', 'my-alias'])
    expect(defaults.hardDeny).toEqual(shipped.hardDeny)

    const rules = readRoot(home, 'pi', 'rules.json')
    expect(rules.directoryDelete.map((rule) => rule.pattern)).toEqual(['rm -rf *', 'rm -r *'])
    // User-owned entries survive verbatim, in place; shipped entries they
    // lack are appended after them.
    expect(rules.staticAllow).toEqual([
      { pattern: 'my-own-allow', reason: 'user custom' },
      { pattern: 'ls', reason: 'read-only listing' },
    ])
  })

  it('backups each written file before the first write and never overwrites an existing backup', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    writeRoot(home, 'pi', piLocalDefaults(shipped), piLocalRules(shipped))
    const defaultsFile = rootFile(home, 'pi', 'defaults.json')
    const rulesFile = rootFile(home, 'pi', 'rules.json')
    const defaultsBefore = readFileSync(defaultsFile, 'utf8')
    const rulesBefore = readFileSync(rulesFile, 'utf8')

    const first = applyRuleUpdate(buildRuleUpdatePlan(home, { shipped }).updates)
    expect(first.ok).toBe(true)
    expect(readFileSync(`${defaultsFile}.auto-guard.bak`, 'utf8')).toBe(defaultsBefore)
    expect(readFileSync(`${rulesFile}.auto-guard.bak`, 'utf8')).toBe(rulesBefore)

    // A pre-existing backup is the user's oldest state — never overwritten.
    writeFileSync(`${defaultsFile}.auto-guard.bak`, 'older-state', 'utf8')
    writeRoot(home, 'qoder', piLocalDefaults(shipped), piLocalRules(shipped))
    const second = applyRuleUpdate(buildRuleUpdatePlan(home, { shipped }).updates)
    expect(second.ok).toBe(true)
    expect(readFileSync(`${defaultsFile}.auto-guard.bak`, 'utf8')).toBe('older-state')
  })

  it('is idempotent: after one accepted run the next plan finds nothing to do', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    writeRoot(home, 'pi', piLocalDefaults(shipped), piLocalRules(shipped))

    const first = buildRuleUpdatePlan(home, { shipped })
    expect(applyRuleUpdate(first.updates).ok).toBe(true)

    const second = buildRuleUpdatePlan(home, { shipped })
    expect(second.updates).toEqual([])
    expect(second.preview).toEqual([])
  })

  it('reports an already-fresh install with no updates and no writes', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    writeRoot(home, 'pi', shipped, shipped)
    const before = readFileSync(rootFile(home, 'pi', 'rules.json'), 'utf8')

    const plan = buildRuleUpdatePlan(home, { shipped })
    expect(plan.updates).toEqual([])
    expect(plan.preview).toEqual([])
    expect(readFileSync(rootFile(home, 'pi', 'rules.json'), 'utf8')).toBe(before)
  })

  it('skips roots that were never seeded and refuses unparseable files without touching them', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    // No auto-guard root anywhere: nothing scanned, nothing blocked.
    expect(buildRuleUpdatePlan(home, { shipped }).updates).toEqual([])

    // Half-seeded root (rules.json only) is left to the runtime seeding path.
    mkdirSync(join(home, rootOf('zcode')), { recursive: true })
    writeFileSync(join(home, rootOf('zcode'), 'rules.json'), '{"version":1}', 'utf8')
    expect(buildRuleUpdatePlan(home, { shipped }).updates).toEqual([])

    // Unparseable defaults: THAT file is blocked and untouched; its parseable
    // sibling (rules.json) still gets the update — refusal is per file.
    writeRoot(home, 'pi', piLocalDefaults(shipped), piLocalRules(shipped))
    writeFileSync(rootFile(home, 'pi', 'defaults.json'), '{ not json', 'utf8')
    const plan = buildRuleUpdatePlan(home, { shipped })
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]!.file).toContain('rules.json')
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]!.file).toContain('defaults.json')
  })

  it('treats a sparse user file as missing fields and fills them from the shipped defaults', () => {
    const home = fakeHome()
    const shipped = shippedFixture()
    writeRoot(home, 'pi', piLocalDefaults(shipped), { version: 1 })

    const plan = buildRuleUpdatePlan(home, { shipped })
    const outcome = applyRuleUpdate(plan.updates)
    expect(outcome.ok).toBe(true)

    const rules = readRoot(home, 'pi', 'rules.json')
    expect(rules.directoryDelete.map((rule) => rule.pattern)).toEqual(['rm -rf *', 'rm -r *'])
    expect(rules.staticAllow.map((rule) => rule.pattern)).toEqual(['ls'])
  })
})

/** A pi config root two shipped-defaults entries behind (real factory defaults). */
function seedStaleRoot(home: string): void {
  const shipped = readDefaults()
  const stale: RulesFile = {
    ...shipped,
    directoryDelete: shipped.directoryDelete.filter((rule) => rule.pattern !== 'rm -r *' && rule.pattern !== 'rm --recursive *'),
  }
  writeRoot(home, 'pi', stale, stale)
}

describe('rule update: init wiring (ticket 02)', () => {
  function installerDeps(home: string): InstallerDeps {
    return {
      home,
      stdinIsTTY: false,
      hasExecutable: (exe) => exe === 'pi',
      runCommand: () => ({ ok: true, stdout: '' }),
    }
  }

  it('init --update-rules appends the missing entries to both layers and exits 0', async () => {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })

    const result = await runCli(['init', '--host', 'pi', '--yes', '--update-rules'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)

    const defaults = readRoot(home, 'pi', 'defaults.json')
    const rules = readRoot(home, 'pi', 'rules.json')
    expect(defaults.directoryDelete.map((rule) => rule.pattern)).toContain('rm -r *')
    expect(rules.directoryDelete.map((rule) => rule.pattern)).toContain('rm --recursive *')
    expect(existsSync(rootFile(home, 'pi', 'defaults.json.auto-guard.bak'))).toBe(true)
    expect(existsSync(rootFile(home, 'pi', 'rules.json.auto-guard.bak'))).toBe(true)
  })

  it('is idempotent end to end: the second --update-rules run reports up to date and writes nothing', async () => {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })

    await runCli(['init', '--host', 'pi', '--yes', '--update-rules'], { installer: installerDeps(home) })
    const defaultsFile = rootFile(home, 'pi', 'defaults.json')
    const contentAfterFirst = readFileSync(defaultsFile, 'utf8')

    const second = await runCli(['init', '--host', 'pi', '--yes', '--update-rules'], { installer: installerDeps(home) })
    expect(second.code).toBe(0)
    expect(second.output.join('\n')).toContain('已是最新')
    expect(readFileSync(defaultsFile, 'utf8')).toBe(contentAfterFirst)
  })

  it('init --skip-rules never writes', async () => {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })

    const result = await runCli(['init', '--host', 'pi', '--yes', '--skip-rules'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    expect(existsSync(rootFile(home, 'pi', 'defaults.json.auto-guard.bak'))).toBe(false)
    const defaults = readRoot(home, 'pi', 'defaults.json')
    expect(defaults.directoryDelete.map((rule) => rule.pattern)).not.toContain('rm -r *')
  })

  it('non-interactive without an explicit flag writes nothing and points at the flags', async () => {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })

    const result = await runCli(['init', '--host', 'pi', '--yes'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('--update-rules')
    expect(existsSync(rootFile(home, 'pi', 'defaults.json.auto-guard.bak'))).toBe(false)
  })

  it('rejects --update-rules together with --skip-rules', async () => {
    const home = fakeHome()
    const result = await runCli(['init', '--host', 'pi', '--yes', '--update-rules', '--skip-rules'], { installer: installerDeps(home) })
    expect(result.code).toBe(2)
  })

  it('remove stays untouched by the rule update step', async () => {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    await runCli(['init', '--host', 'pi', '--yes', '--update-rules'], { installer: installerDeps(home) })

    const result = await runCli(['remove', '--host', 'pi'], { installer: installerDeps(home) })
    expect(result.code).toBe(0)
    // Rules files are user data: remove never deletes them.
    expect(existsSync(rootFile(home, 'pi', 'rules.json'))).toBe(true)
  })
})

describe('rule update: interactive preview and bilingual copy (ticket 03)', () => {
  /** TTY deps with a scripted answer line; every prompt text is recorded. */
  function interactiveDeps(home: string, answers: string[]): InstallerDeps & { prompts: string[] } {
    const prompts: string[] = []
    return {
      home,
      stdinIsTTY: true,
      hasExecutable: (exe) => exe === 'pi',
      runCommand: () => ({ ok: true, stdout: '' }),
      readLine: async (prompt: string) => {
        prompts.push(prompt)
        return answers.shift() ?? ''
      },
      prompts,
    }
  }

  function seedHome(): string {
    const home = fakeHome()
    seedStaleRoot(home)
    mkdirSync(join(home, '.pi'), { recursive: true })
    return home
  }

  it('previews the entries, and confirming lands the same bytes as --update-rules (shared operation layer)', async () => {
    const interactiveHome = seedHome()
    const flagHome = seedHome()
    const deps = interactiveDeps(interactiveHome, ['y'])

    const interactive = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en'], { installer: deps })
    const flagged = await runCli(['init', '--host', 'pi', '--yes', '--update-rules', '--lang', 'en'], { installer: interactiveDeps(flagHome, []) })
    expect(interactive.code).toBe(0)
    expect(flagged.code).toBe(0)

    const out = interactive.output.join('\n')
    expect(out).toContain('Rule update: the factory defaults added')
    expect(out).toContain('+ directoryDelete: rm -r *')
    expect(deps.prompts.filter((prompt) => prompt.includes('Append these rules?'))).toHaveLength(1)

    // Same operation layer ⇒ byte-identical results on both layers.
    for (const file of ['defaults.json', 'rules.json'] as const) {
      expect(readFileSync(rootFile(interactiveHome, 'pi', file), 'utf8')).toBe(readFileSync(rootFile(flagHome, 'pi', file), 'utf8'))
    }
  })

  it('declining leaves the files untouched and asks at most once per init', async () => {
    const home = seedHome()
    const before = readFileSync(rootFile(home, 'pi', 'rules.json'), 'utf8')
    const deps = interactiveDeps(home, ['n'])

    const result = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en'], { installer: deps })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('Rule update skipped (not confirmed')
    expect(readFileSync(rootFile(home, 'pi', 'rules.json'), 'utf8')).toBe(before)
    expect(existsSync(`${rootFile(home, 'pi', 'rules.json')}.auto-guard.bak`)).toBe(false)
    expect(deps.prompts.filter((prompt) => prompt.includes('Append these rules?'))).toHaveLength(1)
  })

  it('copy follows the language setting: zh by default, en with --lang en', async () => {
    const zhHome = seedHome()
    // Interactive accept without the flag: zh header in the output, zh confirm
    // prompt delivered through the prompt line.
    const zhDeps = interactiveDeps(zhHome, ['y'])
    const zh = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'zh'], { installer: zhDeps })
    expect(zh.code).toBe(0)
    expect(zh.output.join('\n')).toContain('规则更新：出厂默认新增了')
    expect(zh.output.join('\n')).toContain('规则更新完成：已更新 2 个规则文件')
    expect(zhDeps.prompts.some((prompt) => prompt.includes('追加这些规则？'))).toBe(true)

    const enHome = seedHome()
    const en = await runCli(['init', '--host', 'pi', '--yes', '--lang', 'en', '--skip-rules'], { installer: interactiveDeps(enHome, []) })
    expect(en.output.join('\n')).toContain('Rule update skipped (--skip-rules)')
  })
})
