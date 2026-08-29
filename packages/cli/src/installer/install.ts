/**
 * Installer command surface (SPEC 0002): `auto-guard init | list | remove`.
 *
 * Runs before the management CLI's config-root resolution — installing must
 * work on a machine where no auto-guard config exists yet. Everything
 * host-specific comes from profiles (ADR-0008); this module only orchestrates:
 * detect → select (TTY multi-select or --host) → show plan/diff → confirm
 * (unless --yes) → backup → write → verify → summary. Exit codes: 0 success,
 * 2 failure / nothing detected / unknown host (ticket 03).
 *
 * Bilingual surface (zh/en): language resolves as `--lang` > `AUTO_GUARD_LANG`
 * > interactive bilingual prompt (init on a TTY only) > `zh`. The zh fallback
 * keeps piped/CI output byte-stable for existing consumers.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { machineConfigPath, readMachineLang, writeMachineLang } from '@auto-guard/core'
import { showBanner, type BannerLang } from './banner.ts'
import { detectHosts } from './detect.ts'
import { envLang, invalidLangMessage, message, normalizeLang, type Lang, type MessageKey } from './i18n.ts'
import { isConfirmed, promptHostSelection, promptLanguage } from './interactive.ts'
import { defaultRunCommand, integrationStatus, type RunCommand } from './integration.ts'
import { applyHostPlan, buildInitPlan } from './plan.ts'
import { removeHost } from './remove.ts'
import { HOST_IDS, profileById, resolveToken, type HostId, type HostProfile, type PackagePaths } from './profiles.ts'

export interface InstallerDeps {
  /** Override HOME (tests, `--home`). */
  home?: string
  /** Override adapter package locations (tests). */
  paths?: PackagePaths
  hasExecutable?: (exe: string) => boolean
  runCommand?: RunCommand
  fileExists?: (p: string) => boolean
  stdinIsTTY?: boolean
  /** Injected prompt line source (tests); prompt text is passed for realism. */
  readLine?: (prompt: string) => Promise<string>
  /** Force the init banner on/off (tests); default follows stdout TTY. */
  banner?: boolean
  /** Banner sink override (tests); default process.stdout. */
  writeOut?: (text: string) => void
}

export interface InstallerResult {
  code: number
  output: string[]
}

/** Resolve the adapter packages installed next to the CLI (workspace or npm layout). */
export function resolvePackagePaths(): PackagePaths {
  const require = createRequire(import.meta.url)
  const dir = (name: string) => dirname(require.resolve(`${name}/package.json`))
  return {
    pi: { srcIndex: join(dir('@auto-guard/host-pi'), 'src', 'index.ts') },
    zcode: {
      distHookCli: join(dir('@auto-guard/host-zcode'), 'dist', 'hook-cli.js'),
      distSessionStart: join(dir('@auto-guard/host-zcode'), 'dist', 'session-start.js'),
    },
    // The dsh adapter's manifest name is `auto-guard` (its dsh-native
    // identity in profile bundles lists), not its old scoped name.
    dsh: { packageDir: dir('auto-guard') },
    claude: {
      distHookCli: join(dir('@auto-guard/host-claude'), 'dist', 'hook-cli.js'),
      distSessionStart: join(dir('@auto-guard/host-claude'), 'dist', 'session-start.js'),
    },
    // opencode loads the plugin from the dist directory (index.js entry);
    // the directory also carries hook-cli.js spawned per decision (ADR-0011).
    opencode: { distPluginDir: join(dir('@auto-guard/host-opencode'), 'dist') },
  }
}

interface InstallerFlags {
  command: 'init' | 'list' | 'remove'
  hosts?: string[]
  yes: boolean
  home?: string
  /** Force the init banner even without a TTY (`--banner`). */
  banner?: boolean
  /** Output language; absent means "not pinned" (env / prompt / zh fallback decide). */
  lang?: Lang
}

/** Pre-scan argv for `--lang`/`--lang=x` so even parse errors speak the right language. */
function scanLangFlag(argv: readonly string[]): { lang?: Lang; invalid?: string } {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const value = arg === '--lang' ? argv[i + 1] : arg.startsWith('--lang=') ? arg.slice('--lang='.length) : undefined
    if (value === undefined) continue
    const lang = normalizeLang(value)
    if (!lang) return { invalid: value }
    return { lang }
  }
  return {}
}

export function parseInstallerArgs(argv: readonly string[], lang: Lang = 'zh'): { ok: true; flags: InstallerFlags } | { ok: false; message: string } {
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const [command, ...rest] = argv
  if (command !== 'init' && command !== 'list' && command !== 'remove') {
    return { ok: false, message: t('usage') }
  }
  const flags: InstallerFlags = { command, yes: false }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    const eq = arg.indexOf('=')
    const name = eq > 1 ? arg.slice(0, eq) : arg
    const inline = eq > 1 ? arg.slice(eq + 1) : undefined
    const value = (): string => {
      if (inline !== undefined) return inline
      const next = rest[++i]
      if (next === undefined) throw new Error(t('flagMissingValue', { name }))
      return next
    }
    try {
      if (name === '--host') {
        flags.hosts = value().split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      } else if (name === '--yes' || name === '-y') {
        flags.yes = true
      } else if (name === '--banner') {
        flags.banner = true
      } else if (name === '--home') {
        flags.home = value()
      } else if (name === '--lang') {
        const raw = value()
        const parsed = normalizeLang(raw)
        if (!parsed) return { ok: false, message: invalidLangMessage(raw) }
        flags.lang = parsed
      } else if (name === '--config-root') {
        // Shared parser flag of the management commands; the installer never
        // touches the guard config root (spec 0002: 配置根不归安装器管).
        value()
      } else {
        return { ok: false, message: t('unknownFlag', { name }) }
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true, flags }
}

/** Entry point used by the CLI shell; argv starts at the subcommand. */
export async function runInstallerCommand(argv: readonly string[], deps: InstallerDeps = {}): Promise<InstallerResult> {
  const scanned = scanLangFlag(argv)
  if (scanned.invalid !== undefined) return { code: 2, output: [invalidLangMessage(scanned.invalid)] }
  const machineLang = () => readMachineLang(machineConfigPath(deps.home ?? homedir()))
  const parsed = parseInstallerArgs(argv, scanned.lang ?? envLang() ?? machineLang() ?? 'zh')
  if (!parsed.ok) return { code: 2, output: [parsed.message] }
  const flags = parsed.flags
  if (flags.command === 'init') return runInit(flags, deps)
  if (flags.command === 'list') return runList(flags, deps)
  return runRemove(flags, deps)
}

function resolveHome(flags: InstallerFlags, deps: InstallerDeps): string {
  return deps.home ?? flags.home ?? homedir()
}

function resolvePaths(deps: InstallerDeps): PackagePaths {
  if (deps.paths) return deps.paths
  return resolvePackagePaths()
}

function validateHostNames(hosts: readonly string[], lang: Lang): string | null {
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const unknown = hosts.filter((h) => !HOST_IDS.includes(h as HostId))
  if (unknown.length) return t('unknownHosts', { hosts: unknown.join(', '), valid: HOST_IDS.join(', ') })
  return null
}

function orderedHosts(hosts: readonly string[]): HostId[] {
  return HOST_IDS.filter((id) => hosts.includes(id))
}

async function runInit(flags: InstallerFlags, deps: InstallerDeps): Promise<InstallerResult> {
  const out: string[] = []
  const home = resolveHome(flags, deps)
  const paths = resolvePaths(deps)
  const fileExists = deps.fileExists ?? existsSync
  const runCommand = deps.runCommand
  const tty = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY)
  const injectedReadLine = deps.readLine
  const ownReadLine = !injectedReadLine && tty ? makeDefaultReadLine() : undefined
  const readLine = injectedReadLine ?? ownReadLine?.ask
  // Machine default layer (ADR-0011): a remembered choice means the language
  // prompt never re-appears on later inits.
  const machineLang = readMachineLang(machineConfigPath(home))
  const interactiveAsk = Boolean(tty && readLine) && !flags.lang && !envLang() && !machineLang

  // The banner leads: it is the first thing any run shows. Before the
  // language prompt resolves, its tagline is bilingual; once pinned or
  // resolved, it renders in that language.
  const pinned = flags.lang ?? envLang()
  const bannerLang: BannerLang = pinned ?? machineLang ?? (interactiveAsk ? 'bilingual' : 'zh')
  showBanner({ enabled: flags.banner ?? deps.banner, lang: bannerLang, write: deps.writeOut })

  let lang: Lang
  if (pinned) {
    lang = pinned
    // `--lang` updates the machine default immediately (ADR-0011): the choice
    // outlives the install and later inits skip the prompt.
    if (flags.lang) writeMachineLang(machineConfigPath(home), lang)
  } else if (machineLang) {
    lang = machineLang
  } else if (interactiveAsk) {
    lang = await promptLanguage(readLine!)
    // Persist right after the prompt, not after the install result: the
    // preference stands even when the user declines every write.
    writeMachineLang(machineConfigPath(home), lang)
  } else {
    lang = 'zh'
  }
  const detections = detectHosts({ home, hasExecutable: deps.hasExecutable, lang })

  try {
    return await runInitBody(flags, deps, { out, home, paths, fileExists, runCommand, tty, detections, readLine, lang })
  } finally {
    ownReadLine?.close()
  }
}

interface InitContext {
  out: string[]
  home: string
  paths: PackagePaths
  fileExists: (p: string) => boolean
  runCommand?: RunCommand
  tty: boolean
  detections: ReturnType<typeof detectHosts>
  readLine?: (prompt: string) => Promise<string>
  lang: Lang
}

async function runInitBody(flags: InstallerFlags, deps: InstallerDeps, ctx: InitContext): Promise<InstallerResult> {
  const { out, home, paths, fileExists, runCommand, tty, detections, readLine, lang } = ctx
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const joiner = lang === 'zh' ? '、' : ', '
  const targetOf = (profile: HostProfile): string => {
    if (profile.action.kind === 'json-merge') return profile.action.file
    return `${profile.action.executable} ${profile.action.installArgs.join(' ')}`
  }
  let selected: HostId[]
  if (flags.hosts?.length) {
    const invalid = validateHostNames(flags.hosts, lang)
    if (invalid) return { code: 2, output: [invalid] }
    for (const id of orderedHosts(flags.hosts)) {
      const detection = detections.find((d) => d.profile.id === id)!
      if (!detection.detected) {
        return { code: 2, output: [t('hostNotDetected', { label: detection.profile.label, home })] }
      }
    }
    selected = orderedHosts(flags.hosts)
  } else {
    if (!tty) {
      return { code: 2, output: [t('nonInteractiveHint')] }
    }
    const { selected: chosen, notes } = await promptHostSelection(
      detections.map((d) => ({ id: d.profile.id, label: d.profile.label, detected: d.detected, evidence: d.evidence, target: targetOf(d.profile) })),
      readLine!,
      lang,
    )
    for (const note of notes) out.push(note)
    if (!chosen.length) return { code: 2, output: [...out, t('nothingSelected')] }
    selected = orderedHosts(chosen)
  }

  const failures: HostId[] = []
  const installed: HostId[] = []

  for (const id of selected) {
    const profile = profileById(id)!
    const status = integrationStatus(id, { home, paths, fileExists, runCommand })
    if (status === 'integrated') {
      out.push(t('alreadyIntegrated', { label: profile.label }))
      continue
    }
    // Profile-declared artifacts (e.g. built entry points) must exist first.
    if (profile.action.kind === 'json-merge') {
      const missing = (profile.action.requiredTokens ?? []).map((token) => resolveToken(token, paths)).filter((p) => !fileExists(p))
      if (missing.length) {
        out.push(t('missingArtifacts', { label: profile.label, files: missing.map((p) => basename(p)).join(joiner) }))
        failures.push(id)
        continue
      }
    }

    const plan = buildInitPlan(profile, { home, paths, lang })
    if (plan.blocked) {
      out.push(`[${plan.label}] ${plan.blocked}`)
      failures.push(id)
      continue
    }
    if (plan.skipped) {
      out.push(`[${plan.label}] ${plan.skipped}`)
      continue
    }

    out.push(t('willDo', { label: plan.label }))
    for (const step of plan.steps) out.push(`  · ${step.description}`)
    for (const line of plan.diff) out.push(`    ${line}`)
    if (!flags.yes) {
      if (!readLine) {
        out.push(t('confirmNeedsNonInteractive', { label: plan.label }))
        failures.push(id)
        continue
      }
      const answer = await readLine(t('confirmWrite', { label: plan.label }))
      if (!isConfirmed(answer)) {
        out.push(t('declined', { label: plan.label }))
        continue
      }
    }

    const outcome = applyHostPlan(plan, { fileExists, runCommand, lang })
    if (outcome.ok) {
      out.push(t('hostDone', { label: plan.label }))
      installed.push(id)
    } else {
      out.push(t('hostFailed', { label: plan.label, step: outcome.failedStep ?? '?', error: outcome.error ?? '' }))
      failures.push(id)
    }
  }

  if (installed.length) {
    out.push('')
    out.push(t('installDone'))
    for (const id of installed) {
      const profile = profileById(id)!
      out.push(t('summaryEntry', { label: profile.label, note: message(lang, profile.sessionNote) }))
      for (const note of profile.postInstallNotes ?? []) out.push(`    ${message(lang, note)}`)
    }
    out.push(t('verifyHint'))
    out.push(t('configHint'))
    out.push(t('uninstallHint'))
    out.push(t('seedingNote'))
  }
  if (failures.length) out.push(t('failuresSummary', { count: failures.length, hosts: failures.join(', ') }))
  return { code: failures.length ? 2 : 0, output: out }
}

function runList(flags: InstallerFlags, deps: InstallerDeps): InstallerResult {
  const home = resolveHome(flags, deps)
  const lang = flags.lang ?? envLang() ?? readMachineLang(machineConfigPath(home)) ?? 'zh'
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const joiner = lang === 'zh' ? '；' : '; '
  const out: string[] = []
  const paths = resolvePaths(deps)
  const fileExists = deps.fileExists ?? existsSync
  const detections = detectHosts({ home, hasExecutable: deps.hasExecutable, lang })
  for (const { profile, detected, evidence } of detections) {
    out.push(`[${profile.label}]`)
    out.push(t('listDetectLine', { value: detected ? t('detectedYes', { evidence: evidence.join(joiner) }) : t('detectedNo') }))
    // An undetected host is by definition not integrated — don't confuse a
    // failing status probe (e.g. no dsh CLI) with "unknown, check manually".
    const status = detected ? integrationStatus(profile.id, { home, paths, fileExists, runCommand: deps.runCommand }) : 'not-integrated'
    out.push(t('listIntegratedLine', { value: status === 'integrated' ? t('integratedYes') : status === 'not-integrated' ? t('integratedNo') : t('integratedUnknown') }))
    if (status === 'not-integrated') {
      out.push(t('listNextLine', { value: detected ? t('nextRunInit', { id: profile.id }) : t('nextInstallFirst', { label: profile.label, id: profile.id }) }))
    } else if (status === 'integrated') {
      out.push(t('listVerifyLine'))
    } else {
      out.push(t('listManualCheck'))
    }
  }
  return { code: 0, output: out }
}

function runRemove(flags: InstallerFlags, deps: InstallerDeps): InstallerResult {
  const home = resolveHome(flags, deps)
  // remove never touches the machine default: the language preference is
  // kept, mirroring "data roots are kept" (ADR-0011).
  const lang = flags.lang ?? envLang() ?? readMachineLang(machineConfigPath(home)) ?? 'zh'
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const out: string[] = []
  const fileExists = deps.fileExists ?? existsSync
  const hosts = flags.hosts?.length ? flags.hosts : [...HOST_IDS]
  const invalid = validateHostNames(hosts, lang)
  if (invalid) return { code: 2, output: [invalid] }

  let failed = 0
  for (const id of orderedHosts(hosts)) {
    const profile = profileById(id)!
    const outcome = removeHost(profile, { home, fileExists, runCommand: deps.runCommand ?? defaultRunCommand, lang })
    if (outcome.status === 'failed') failed++
    out.push(`[${profile.label}] ${outcome.message ?? (outcome.status === 'removed' || outcome.status === 'restored' ? t('removeOutcomeDone') : t('removeOutcomeUntouched'))}`)
  }
  out.push(t('removeDataNote'))
  return { code: failed ? 2 : 0, output: out }
}

interface DefaultReadLine {
  ask: (prompt: string) => Promise<string>
  close: () => void
}

function makeDefaultReadLine(): DefaultReadLine {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return { ask: (prompt: string) => rl.question(prompt), close: () => rl.close() }
}
