/**
 * Action layer (SPEC 0009 ticket 03 / ADR-0014): every management action is
 * `runCli` and every installer action is `runInstallerCommand` — one semantic
 * source of truth, tested seams reused. Structured reads (dashboard cards,
 * install previews) call the same read functions the CLI uses. The set-key
 * wizard saves through core ops directly because the unified CLI's `set
 * set-key` branch refuses unconditionally (documented gap, SPEC 0009).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '@auto-guard/cli/shell'
import { runInstallerCommand, resolvePackagePaths } from '@auto-guard/cli/installer'
import { buildInitPlan, type HostPlan } from '@auto-guard/cli/installer/plan'
import { buildRuleUpdatePlan } from '@auto-guard/cli/installer/rule-update'
import { detectHosts, type DetectionResult } from '@auto-guard/cli/installer/detect'
import { HOST_IDS, PROFILES, profileById, type HostId } from '@auto-guard/cli/installer/profiles'
import { readStatus } from '@auto-guard/cli/status-store'
import {
  applySetApi,
  createAuditStore,
  defaultGuardConfig,
  envLang,
  hasStoredApiKey,
  loadAuditPassword,
  loadConfig,
  machineConfigPath,
  readMachineLang,
  saveApiKey,
  saveConfig,
  writeMachineLang,
  type GuardConfig,
  type Lang,
} from '@auto-guard/core'
import type { PendingRun, Receipt, RootSummary, WizardInput } from './types.ts'

export interface ActionDeps {
  runCli?: typeof runCli
  runInstaller?: typeof runInstallerCommand
  home?: string
  exists?: (p: string) => boolean
  readStatusFile?: (path: string) => ReturnType<typeof readStatus>
}

/** Add `--config-root <root>` unless the argv already carries one. */
export function injectConfigRoot(argv: readonly string[], root: string): string[] {
  if (!root || argv.includes('--config-root')) return [...argv]
  return [...argv, '--config-root', root]
}

/**
 * Execute one pending run; returns the receipt for the log screen. Receipts
 * record `run.argv` verbatim — the user-visible command. Root targeting is
 * out-of-band (`run.root` / the driver's current root) and becomes the
 * injected `--config-root` at execution time only (SPEC 0011).
 */
export async function execRun(deps: ActionDeps, run: PendingRun, root: string, id: number): Promise<Receipt> {
  const argv = run.kind === 'mgmt' ? injectConfigRoot(run.argv, run.root || root) : [...run.argv]
  // Installer runs are forced non-interactive: the TUI owns the terminal
  // (raw mode), so the installer's own readline must never take over — its
  // interactive flows are re-expressed by the installer screen instead.
  const installerDeps = { stdinIsTTY: false, banner: false, writeOut: () => {} } as Parameters<typeof runInstallerCommand>[1]
  const result =
    run.kind === 'mgmt'
      ? await (deps.runCli ?? runCli)(argv)
      : await (deps.runInstaller ?? runInstallerCommand)(argv, installerDeps)
  // The CLI contract allows elements with embedded newlines (tables are
  // joined before push); panes render one element as one row, so split them
  // into real lines at the seam — otherwise whole outputs collapse into a
  // single truncated row (real-terminal bug, SPEC 0011 follow-up).
  return { id, argv: run.argv.join(' '), code: result.code, output: result.output.flatMap((line) => line.split(/\r?\n/)) }
}

// ---------- dashboard structured reads ----------

/** Summaries for every standard host root (mirrors aggregate `guard status`). */
export function loadRootSummaries(deps: ActionDeps = {}): RootSummary[] {
  const home = deps.home ?? homedir()
  const exists = deps.exists ?? existsSync
  return PROFILES.map((profile) => {
    const hostHome = join(home, profile.detection.dirs[0]!)
    const root = join(hostHome, 'auto-guard')
    const summary: RootSummary = {
      hostId: profile.id,
      label: profile.label.replace(/ Coding Agent$/, ''),
      homeDir: hostHome,
      root,
      installed: exists(hostHome),
      seeded: exists(join(root, 'config.json')),
    }
    if (!summary.seeded) return summary
    // Seeded only: loadConfig seeds defaults on read, so unseeded roots are
    // never touched from the dashboard (same discipline as aggregate status).
    const config = loadConfig(join(root, 'config.json'), defaultGuardConfig(root))
    summary.config = config
    summary.status = (deps.readStatusFile ?? readStatus)(join(root, 'status.json'))
    summary.keyStored = hasStoredApiKey(root)
    summary.keyEnvName = config.apiKeyEnv
    if (config.examineEnabled) {
      const audit = createAuditStore(config.auditDbPath, loadAuditPassword(root))
      try {
        summary.auditCount = audit.count()
      } finally {
        audit.close()
      }
    }
    return summary
  })
}

/** Auto-detected default root, same order as the CLI (`.zcode` → … → `.dsh`). */
export function detectRoot(deps: ActionDeps = {}): string {
  const home = deps.home ?? homedir()
  const exists = deps.exists ?? existsSync
  for (const dir of ['.zcode', '.claude', join('.config', 'opencode'), '.pi', '.dsh']) {
    if (exists(join(home, dir))) return join(home, dir, 'auto-guard')
  }
  return ''
}

// ---------- installer screen ----------

export function detect(deps: ActionDeps = {}, lang: Lang = 'zh'): DetectionResult[] {
  return detectHosts({ home: deps.home ?? homedir(), lang })
}

/** True when the installer language must be asked (no env, no machine default). */
export function needsInstallerLang(): boolean {
  return !envLang() && !readMachineLang(machineConfigPath(homedir()))
}

/** Persist the installer language choice as the machine default (ADR-0011). */
export function saveMachineLangSafe(lang: Lang): void {
  writeMachineLang(machineConfigPath(homedir()), lang)
}

/** Render the plan + rule-update preview exactly as `init` would apply it. */
export function buildPreview(deps: ActionDeps, hostIds: readonly HostId[], rules: 'update' | 'skip', lang: Lang): string[] {
  const home = deps.home ?? homedir()
  const paths = resolvePackagePaths()
  const lines: string[] = []
  for (const id of hostIds) {
    const profile = profileById(id)
    if (!profile) continue
    const plan: HostPlan = buildInitPlan(profile, { home, paths, lang })
    lines.push(`■ ${profile.label}`)
    if (plan.skipped) lines.push(`  · ${plan.skipped}`)
    if (plan.blocked) lines.push(`  ! ${plan.blocked}`)
    for (const step of plan.steps) lines.push(`  · ${step.description}`)
    for (const diff of plan.diff) lines.push(`  ${diff}`)
  }
  if (rules === 'update') {
    const rulePlan = buildRuleUpdatePlan(home, { lang })
    for (const entry of rulePlan.preview) {
      lines.push(`■ + ${entry.field}: ${entry.pattern}${entry.reason ? ` — ${entry.reason}` : ''}`)
    }
    for (const blocked of rulePlan.blocked) lines.push(`■ ! ${blocked.displayPath}: ${blocked.reason}`)
  }
  return lines
}

/** The exact installer argv equivalent to the TUI's previewed apply. */
export function buildInitArgv(hostIds: readonly HostId[], rules: 'update' | 'skip', lang: Lang): string[] {
  const ordered = HOST_IDS.filter((id) => hostIds.includes(id))
  const flags = rules === 'update' ? '--update-rules' : '--skip-rules'
  return ['init', '--host', ordered.join(','), flags, '--yes', '--lang', lang]
}

export function buildRemoveArgv(hostIds: readonly HostId[]): string[] {
  const ordered = HOST_IDS.filter((id) => hostIds.includes(id))
  return ['remove', '--host', ordered.join(','), '--yes']
}

// ---------- set-key wizard (SPEC 0009: three-step wizard semantics) ----------

export type WizardResult = { ok: true; message: string } | { ok: false; error: 'invalidBase' | 'invalidKey' }

/** Validate wizard input with the same rules as the zcode TTY wizard. */
export function validateWizard(input: WizardInput): WizardResult {
  if (input.base && !/^https?:\/\//.test(input.base)) return { ok: false, error: 'invalidBase' }
  const key = input.key.trim()
  if (key.length < 8 || /\s/.test(key)) return { ok: false, error: 'invalidKey' }
  return { ok: true, message: key }
}

/** Persist the wizard result: endpoint changes go through `applySetApi`
 * (same receipts as `set set-api`), the key through the encrypted key store.
 */
export function saveWizard(root: string, input: WizardInput, lang: Lang): { changedEndpoint: boolean } {
  const configPath = join(root, 'config.json')
  const config: GuardConfig = loadConfig(configPath, defaultGuardConfig(root))
  let changedEndpoint = false
  const base = input.base.trim().replace(/\/+$/, '')
  if (base && base !== config.apiBase) {
    applySetApi(config, 'base', base, config, lang)
    changedEndpoint = true
  }
  if (input.model.trim() && input.model.trim() !== config.model) {
    applySetApi(config, 'model', input.model.trim(), config, lang)
    changedEndpoint = true
  }
  if (changedEndpoint) saveConfig(config, configPath)
  saveApiKey(root, input.key.trim())
  return { changedEndpoint }
}
