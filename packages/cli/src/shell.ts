/**
 * Unified management CLI shell (ADR-0009 terminal half).
 *
 * Argument parsing, table rendering and TTY interaction over the shared core
 * operations layer. I/O-producing collaborators (reviewer, audit store) are
 * injectable so integration tests run with fakes and no network or real
 * SQLite. Windows discipline: natural exit, set-key requires a real TTY,
 * exit codes 0/2.
 *
 * Output language follows the four-layer resolution (ADR-0011):
 * `AUTO_GUARD_LANG` > per-host config.lang > machine default > zh. Commands
 * that print before a config root is known use the env/machine layers only.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeLearnedRules,
  applyHistoryToggle,
  applySetApi,
  applySetLang,
  clearApiKey,
  coreMessage,
  createAuditStore,
  DeepSeekReviewer,
  effectiveLang,
  envLang,
  examineStatusLines,
  hasStoredApiKey,
  hydrateApiKey,
  loadAnalyzeState,
  defaultGuardConfig,
  loadAuditPassword,
  loadApiKey,
  loadConfig,
  loadLearnedRules,
  loadRules,
  machineConfigPath,
  maskKey,
  optimizeListLines,
  optimizeStatusLines,
  readMachineLang,
  recentLines,
  reportLines,
  rollbackLearnedRules,
  saveApiKey,
  saveConfig,
  setEnabled,
  statusLines,
  type AuditStore,
  type GuardConfig,
  type Lang,
  type LlmReviewer,
} from '@auto-guard/core'
import { readRecentDecisions, readStatus } from './status-store.ts'
import { runInstallerCommand, type InstallerDeps } from './installer/install.ts'
import { PROFILES } from './installer/profiles.ts'
import { shellMessage } from './shell-messages.ts'

/** Lightweight connectivity check result (see core DeepSeekReviewer). */
interface PingResult {
  ok: boolean
  error?: string
}

/** Reviewer with the optional connectivity check used by `guard ping`. */
export type PingableReviewer = LlmReviewer & { ping(): Promise<PingResult> }

/** Overridable collaborators for tests. */
export interface CliDeps {
  makeReviewer?: (config: GuardConfig) => PingableReviewer
  makeAudit?: (config: GuardConfig, password?: string) => AuditStore
  /** Override host-root auto-detection (tests). */
  detectRoot?: () => string | undefined
  /** Installer collaborators (SPEC 0002 init/list/remove). */
  installer?: InstallerDeps
  /** Override the standard per-host roots scanned by aggregate `guard status` (tests). */
  hostRoots?: () => readonly HostRootRef[]
  /** Environment override for language resolution (tests); default process.env. */
  env?: Record<string, string | undefined>
  /** Override the machine-default config path (tests); default ~/.auto-guard/config.json. */
  machineLangPath?: string
}

export interface RunResult {
  code: number
  output: string[]
}

interface Ctx {
  out: string[]
  configRoot: string
  configPath: string
  /** True when the root came from `--config-root`/env — aggregate views stay off. */
  explicitRoot: boolean
}

/** One standard host data root: where the host's guard config is seeded. */
export interface HostRootRef {
  label: string
  /** Host home directory (e.g. `~/.pi`) — its existence means the host is installed. */
  homeDir: string
  /** Guard data root (e.g. `~/.pi/auto-guard`). */
  root: string
}

function defaultHostRoots(): HostRootRef[] {
  const home = homedir()
  return PROFILES.map((profile) => {
    const dir = join(home, profile.detection.dirs[0]!)
    return { label: profile.label, homeDir: dir, root: join(dir, 'auto-guard') }
  })
}

function detectConfigRoot(): string | undefined {
  const home = homedir()
  for (const dir of ['.zcode', '.claude', join('.config', 'opencode'), '.pi', '.dsh']) {
    if (existsSync(join(home, dir))) return join(home, dir, 'auto-guard')
  }
  return undefined
}

function resolveConfigRoot(deps: CliDeps): string | undefined {
  if (deps.detectRoot) return deps.detectRoot()
  return detectConfigRoot()
}

/** Four-layer language resolution for one invocation; `configLang` is the loaded root's own setting. */
function resolveCliLang(deps: CliDeps, configLang?: Lang): Lang {
  return effectiveLang({
    env: envLang(deps.env ?? process.env),
    configLang,
    machineLang: readMachineLang(deps.machineLangPath ?? machineConfigPath(homedir())),
  })
}

/** Load, save and audit access, all rooted at the given config root. */
function openRoot(configRoot: string, deps: CliDeps) {
  const configPath = join(configRoot, 'config.json')
  return {
    configPath,
    load: () => loadConfig(configPath, defaultGuardConfig(configRoot)),
    save: (config: GuardConfig) => saveConfig(config, configPath),
    auditFor: (config: GuardConfig): AuditStore =>
      deps.makeAudit ? deps.makeAudit(config, loadAuditPassword(configRoot)) : createAuditStore(config.auditDbPath, loadAuditPassword(configRoot)),
  }
}

/** Run one CLI invocation. `argv` excludes the binary name. */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<RunResult> {
  const out: string[] = []
  let args = [...argv]

  // Strip the shared config-root flag first so `--config-root X init` still
  // dispatches; the installer accepts and ignores the flag (spec 0002: the
  // guard config root is not the installer's business).
  let configRoot = ''
  let explicitRoot = false
  const rootIndex = args.indexOf('--config-root')
  if (rootIndex >= 0) {
    configRoot = args[rootIndex + 1] ?? ''
    args = [...args.slice(0, rootIndex), ...args.slice(rootIndex + 2)]
    explicitRoot = configRoot !== ''
  } else if (process.env.AUTO_GUARD_CONFIG_ROOT) {
    configRoot = process.env.AUTO_GUARD_CONFIG_ROOT
    explicitRoot = true
  }

  // Installer commands run before config-root resolution: installing must
  // work on machines where no auto-guard config root exists yet (SPEC 0002).
  if (args.length && (args[0] === 'init' || args[0] === 'list' || args[0] === 'remove')) {
    return runInstallerCommand(args, deps.installer ?? {})
  }

  if (!configRoot) {
    const detected = resolveConfigRoot(deps)
    if (!detected) {
      out.push(shellMessage(resolveCliLang(deps), 'noRootFound'))
      return { code: 2, output: out }
    }
    configRoot = detected
  }

  const [group, action = '', ...rest] = args
  const io = openRoot(configRoot, deps)
  const ctx: Ctx = { out, configRoot, configPath: io.configPath, explicitRoot }

  switch (group) {
    case 'guard':
      return guardCommand(action, rest, ctx, io, deps)
    case 'set':
      return setCommand(action, rest, ctx, io, deps)
    case 'examine':
      return examineCommand(action, ctx, io, deps)
    case 'optimize':
      return optimizeCommand(action, ctx, io, deps)
    default:
      out.push(shellMessage(resolveCliLang(deps), 'usage'))
      return { code: 1, output: out }
  }
}

/** Tilde-collapse the home prefix for display (`C:\Users\me\.pi` → `~/.pi`). */
function tildePath(p: string): string {
  const home = homedir()
  if (p.startsWith(`${home}\\`) || p.startsWith(`${home}/`)) {
    return `~${p.slice(home.length).replaceAll('\\', '/')}`
  }
  return p
}

/**
 * `guard status` across every standard host root (ADR-0003: one root per
 * host). Seeded roots render the full single-root status; hosts that are
 * installed but never ran a guarded session show as unseeded; hosts absent
 * from the machine are skipped entirely.
 */
function aggregateStatusLines(roots: readonly HostRootRef[], deps: CliDeps): string[] {
  const viewLang = resolveCliLang(deps)
  const lines: string[] = [shellMessage(viewLang, 'aggregateHeader')]
  for (const { label, homeDir, root } of roots) {
    if (!existsSync(homeDir)) continue
    lines.push('')
    if (!existsSync(root)) {
      const hostName = label.replace(/ Coding Agent$/, '')
      lines.push(shellMessage(viewLang, 'aggregateUnseeded', { label, root: tildePath(root), host: hostName }))
      continue
    }
    lines.push(`🛡️ ${label} — ${tildePath(root)}`)
    const io = openRoot(root, deps)
    const config = io.load()
    const lang = resolveCliLang(deps, config.lang)
    let auditCount: number | undefined
    if (config.examineEnabled) {
      const audit = io.auditFor(config)
      try {
        auditCount = audit.count()
      } finally {
        audit.close()
      }
    }
    for (const line of statusLines(config, readStatus(join(root, 'status.json')), join(root, 'config.json'), auditCount, lang)) {
      lines.push(`  ${line}`)
    }
  }
  lines.push('')
  lines.push(shellMessage(viewLang, 'aggregateFooter'))
  return lines
}

function guardCommand(
  action: string,
  rest: readonly string[],
  ctx: Ctx,
  io: ReturnType<typeof openRoot>,
  deps: CliDeps,
): RunResult | Promise<RunResult> {
  // Aggregate view goes first so an unseeded auto-detected root is not
  // created as a side effect of reading status (io.load() seeds defaults).
  if (action === 'status' && !ctx.explicitRoot) {
    const roots = deps.hostRoots?.() ?? defaultHostRoots()
    ctx.out.push(aggregateStatusLines(roots, deps).join('\n'))
    return { code: 0, output: ctx.out }
  }
  // Read-only group: hydrate the encrypted key so status/ping see it.
  const config = hydrateApiKey(io.load(), () => loadApiKey(ctx.configRoot))
  const lang = resolveCliLang(deps, config.lang)
  switch (action) {
    case 'on':
    case 'off': {
      ctx.out.push(setEnabled(config, action === 'on', lang))
      io.save(config)
      return { code: 0, output: ctx.out }
    }
    case 'status': {
      let auditCount: number | undefined
      if (config.examineEnabled) {
        const audit = io.auditFor(config)
        try {
          auditCount = audit.count()
        } finally {
          audit.close()
        }
      }
      ctx.out.push(statusLines(config, readStatus(join(ctx.configRoot, 'status.json')), ctx.configPath, auditCount, lang).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'recent': {
      const count = Number(rest[0]) > 0 ? Number(rest[0]) : 10
      ctx.out.push(recentLines(readRecentDecisions(count, join(ctx.configRoot, 'decision-history.jsonl')), count, lang).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'stats': {
      if (config.examineEnabled) {
        const audit = io.auditFor(config)
        try {
          ctx.out.push(shellMessage(lang, 'statsAuditCount', { count: audit.count() }))
        } finally {
          audit.close()
        }
      } else {
        ctx.out.push(shellMessage(lang, 'statsExamineOff'))
      }
      return { code: 0, output: ctx.out }
    }
    case 'report': {
      const days = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : 7
      if (!config.examineEnabled) {
        ctx.out.push(shellMessage(lang, 'statsExamineOff'))
        return { code: 0, output: ctx.out }
      }
      const audit = io.auditFor(config)
      try {
        ctx.out.push(reportLines(audit.summarizeSince(days), days, lang).join('\n'))
      } finally {
        audit.close()
      }
      return { code: 0, output: ctx.out }
    }
    case 'ping': {
      const reviewer: PingableReviewer = deps.makeReviewer ? deps.makeReviewer(config) : new DeepSeekReviewer(config, lang)
      return reviewer.ping().then((result) => {
        ctx.out.push(result.ok ? shellMessage(lang, 'pingOk') : shellMessage(lang, 'pingFail', { error: result.error ?? shellMessage(lang, 'unknownError') }))
        return { code: result.ok ? 0 : 2, output: ctx.out }
      })
    }
    default:
      ctx.out.push(shellMessage(lang, 'guardUsage'))
      return { code: 1, output: ctx.out }
  }
}

function setCommand(action: string, rest: readonly string[], ctx: Ctx, io: ReturnType<typeof openRoot>, deps: CliDeps): RunResult {
  const config = io.load()
  const lang = resolveCliLang(deps, config.lang)
  switch (action) {
    case 'set-key':
      ctx.out.push(shellMessage(lang, 'setKeyNeedsTty'))
      return { code: 2, output: ctx.out }
    case 'show-key': {
      const envSet = Boolean((deps.env ?? process.env)[config.apiKeyEnv])
      ctx.out.push(
        [
          shellMessage(lang, envSet ? 'showKeyEnvSet' : 'showKeyEnvUnset', { name: config.apiKeyEnv }),
          hasStoredApiKey(ctx.configRoot) ? shellMessage(lang, 'showKeyStored', { root: ctx.configRoot }) : shellMessage(lang, 'showKeyNoStore'),
          config.apiKey && !config.apiKey.startsWith('v1:')
            ? shellMessage(lang, 'showKeyLegacy', { key: maskKey(config.apiKey) })
            : shellMessage(lang, 'showKeyNoLegacy'),
        ].join('\n'),
      )
      return { code: 0, output: ctx.out }
    }
    case 'clear-key': {
      clearApiKey(ctx.configRoot)
      ctx.out.push(shellMessage(lang, 'clearKeyDone'))
      return { code: 0, output: ctx.out }
    }
    case 'set-api': {
      const result = applySetApi(config, rest[0], rest[1], io.load(), lang)
      if (result.ok) io.save(config)
      ctx.out.push(result.message)
      return { code: result.ok ? 0 : 1, output: ctx.out }
    }
    case 'lang': {
      const result = applySetLang(config, rest[0])
      if (!result.ok || !result.lang) {
        ctx.out.push(shellMessage(lang, 'setLangInvalid', { value: rest[0] ?? '' }))
        return { code: 1, output: ctx.out }
      }
      io.save(config)
      // Receipt in the newly selected language: immediate proof the setting took effect.
      ctx.out.push(shellMessage(result.lang, 'setLangDone', { lang: result.lang }))
      return { code: 0, output: ctx.out }
    }
    case 'history': {
      const result = applyHistoryToggle(config, rest[0], lang)
      if (result.ok) io.save(config)
      ctx.out.push(result.messages.join('\n'))
      return { code: result.ok ? 0 : 1, output: ctx.out }
    }
    case 'reload':
      ctx.out.push(shellMessage(lang, 'reloadNote'))
      return { code: 0, output: ctx.out }
    default:
      ctx.out.push(shellMessage(lang, 'setUsage'))
      return { code: 1, output: ctx.out }
  }
}

function examineCommand(action: string, ctx: Ctx, io: ReturnType<typeof openRoot>, deps: CliDeps): RunResult {
  const config = io.load()
  const lang = resolveCliLang(deps, config.lang)
  switch (action) {
    case 'on': {
      config.examineEnabled = true
      io.save(config)
      ctx.out.push(shellMessage(lang, 'examineOn'))
      return { code: 0, output: ctx.out }
    }
    case 'off': {
      config.examineEnabled = false
      io.save(config)
      ctx.out.push(shellMessage(lang, 'examineOff'))
      return { code: 0, output: ctx.out }
    }
    case 'status': {
      ctx.out.push(examineStatusLines(config).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'clear-old':
    case 'clear-all': {
      const audit = io.auditFor(config)
      try {
        if (action === 'clear-old') {
          ctx.out.push(shellMessage(lang, 'examineClearedOld', { count: audit.clearOld(30) }))
        } else {
          audit.clearAll()
          ctx.out.push(shellMessage(lang, 'examineClearedAll'))
        }
      } finally {
        audit.close()
      }
      return { code: 0, output: ctx.out }
    }
    default:
      ctx.out.push(shellMessage(lang, 'examineUsage'))
      return { code: 1, output: ctx.out }
  }
}

function optimizeCommand(action: string, ctx: Ctx, io: ReturnType<typeof openRoot>, deps: CliDeps): RunResult {
  const config = io.load()
  const lang = resolveCliLang(deps, config.lang)
  switch (action) {
    case 'status': {
      ctx.out.push(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt, lang).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'analyze': {
      if (!config.examineEnabled) {
        ctx.out.push(coreMessage(lang, 'analyzeNeedsExamine'))
        return { code: 2, output: ctx.out }
      }
      const audit = io.auditFor(config)
      try {
        const rules = loadRules(config.rulesPath, config.defaultRulesPath)
        const result = analyzeLearnedRules({ config, rules, audit }, lang)
        ctx.out.push(result.message)
        return { code: result.ok ? 0 : 2, output: ctx.out }
      } finally {
        audit.close()
      }
    }
    case 'list': {
      ctx.out.push(optimizeListLines(loadLearnedRules(config.learnedRulesPath), lang).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'rollback': {
      const result = rollbackLearnedRules(config, lang)
      ctx.out.push(result.message)
      return { code: result.ok ? 0 : 2, output: ctx.out }
    }
    default:
      ctx.out.push(shellMessage(lang, 'optimizeUsage'))
      return { code: 1, output: ctx.out }
  }
}
