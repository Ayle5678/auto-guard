/**
 * Unified management CLI driver (ADR-0009 terminal half, ADR-0022 thin
 * driver): installer, root auto-detection, the aggregate view wiring and the
 * driver shell over the single dispatch engine. Every shared command action
 * lives in `createCliMain` (host-runtime) — this file declares what the
 * unified entry can do (installer groups, aggregate status, audit-counted
 * status, no ask group, no set-key wizard) and buffers output for the
 * `RunResult` seam the bin and the TUI consume.
 *
 * Windows discipline: natural exit, set-key requires a real TTY, exit
 * codes 0/2.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadAuditPassword, type AuditStore, type GuardConfig } from '@auto-guard/core'
import { createCliMain, type HostRootRef, type PingableReviewer } from '@auto-guard/host-runtime'
import { runInstallerCommand, type InstallerDeps } from './installer/install.ts'
import { PROFILES } from './installer/profiles.ts'
import { shellMessage, type ShellMessageKey } from './shell-messages.ts'

export type { HostRootRef, PingableReviewer }

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

/** Run one CLI invocation. `argv` excludes the binary name. */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<RunResult> {
  const output: string[] = []
  const main = createCliMain({
    programName: 'auto-guard',
    // Capability gating keeps the cast honest: every key the engine can emit
    // with this capability set exists in the shell catalog.
    message: (lang, key, params = {}) => shellMessage(lang, key as ShellMessageKey, params),
    writeOut: (text) => {
      output.push(text)
    },
    capabilities: { aggregateStatus: true, statusAuditCount: true, analyzeRequiresExamine: true },
    root: {
      mode: 'auto',
      envRoot: () => process.env.AUTO_GUARD_CONFIG_ROOT,
      detect: deps.detectRoot ?? detectConfigRoot,
      hostRoots: deps.hostRoots ?? defaultHostRoots,
      installer: (args) => runInstallerCommand(args, deps.installer ?? {}),
      env: deps.env,
      machineLangPath: deps.machineLangPath,
    },
    makeAudit: deps.makeAudit ? (root, config) => deps.makeAudit!(config, loadAuditPassword(root)) : undefined,
    makeReviewer: deps.makeReviewer,
  })
  const code = await main(argv)
  return { code, output }
}
