/**
 * Installer command surface (SPEC 0002): `auto-guard init | list | remove`.
 *
 * Runs before the management CLI's config-root resolution — installing must
 * work on a machine where no auto-guard config exists yet. Everything
 * host-specific comes from profiles (ADR-0008); this module only orchestrates:
 * detect → select (TTY multi-select or --host) → show plan/diff → confirm
 * (unless --yes) → backup → write → verify → summary. Exit codes: 0 success,
 * 2 failure / nothing detected / unknown host (ticket 03).
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { detectHosts } from './detect.ts'
import { isConfirmed, promptHostSelection } from './interactive.ts'
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
    dsh: { packageDir: dir('@auto-guard/host-dsh') },
  }
}

interface InstallerFlags {
  command: 'init' | 'list' | 'remove'
  hosts?: string[]
  yes: boolean
  home?: string
}

export function parseInstallerArgs(argv: readonly string[]): { ok: true; flags: InstallerFlags } | { ok: false; message: string } {
  const [command, ...rest] = argv
  if (command !== 'init' && command !== 'list' && command !== 'remove') {
    return { ok: false, message: '用法：auto-guard <init|list|remove> [--host dsh,pi,zcode] [--yes] [--home <path>]' }
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
      if (next === undefined) throw new Error(`${name} 缺少参数值`)
      return next
    }
    try {
      if (name === '--host') {
        flags.hosts = value().split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      } else if (name === '--yes' || name === '-y') {
        flags.yes = true
      } else if (name === '--home') {
        flags.home = value()
      } else if (name === '--config-root') {
        // Shared parser flag of the management commands; the installer never
        // touches the guard config root (spec 0002: 配置根不归安装器管).
        value()
      } else {
        return { ok: false, message: `未知参数：${name}（可用：--host --yes --home）` }
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true, flags }
}

/** Entry point used by the CLI shell; argv starts at the subcommand. */
export async function runInstallerCommand(argv: readonly string[], deps: InstallerDeps = {}): Promise<InstallerResult> {
  const parsed = parseInstallerArgs(argv)
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

function validateHostNames(hosts: readonly string[]): string | null {
  const unknown = hosts.filter((h) => !HOST_IDS.includes(h as HostId))
  if (unknown.length) return `未知宿主：${unknown.join(', ')}（可用值：${HOST_IDS.join(', ')}）`
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
  const detections = detectHosts({ home, hasExecutable: deps.hasExecutable })
  const injectedReadLine = deps.readLine
  const ownReadLine = !injectedReadLine && tty ? makeDefaultReadLine() : undefined
  const readLine = injectedReadLine ?? ownReadLine?.ask

  try {
    return await runInitBody(flags, deps, { out, home, paths, fileExists, runCommand, tty, detections, readLine })
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
}

async function runInitBody(flags: InstallerFlags, deps: InstallerDeps, ctx: InitContext): Promise<InstallerResult> {
  const { out, home, paths, fileExists, runCommand, tty, detections, readLine } = ctx
  const targetOf = (profile: HostProfile): string => {
    if (profile.action.kind === 'json-merge') return profile.action.file
    return `${profile.action.executable} ${profile.action.installArgs.join(' ')}`
  }
  let selected: HostId[]
  if (flags.hosts?.length) {
    const invalid = validateHostNames(flags.hosts)
    if (invalid) return { code: 2, output: [invalid] }
    for (const id of orderedHosts(flags.hosts)) {
      const detection = detections.find((d) => d.profile.id === id)!
      if (!detection.detected) {
        return { code: 2, output: [`未检测到 ${detection.profile.label}（${home} 下无宿主特征）：请先安装宿主，或在交互终端中运行 init 以手动确认`] }
      }
    }
    selected = orderedHosts(flags.hosts)
  } else {
    if (!tty) {
      return { code: 2, output: ['当前环境非交互终端：请使用 --host <dsh|pi|zcode> 指定宿主并加 --yes，例如 auto-guard init --host pi,zcode --yes'] }
    }
    const { selected: chosen, notes } = await promptHostSelection(
      detections.map((d) => ({ id: d.profile.id, label: d.profile.label, detected: d.detected, evidence: d.evidence, target: targetOf(d.profile) })),
      readLine!,
    )
    for (const note of notes) out.push(note)
    if (!chosen.length) return { code: 2, output: [...out, '未选择任何宿主，退出'] }
    selected = orderedHosts(chosen)
  }

  const failures: HostId[] = []
  const installed: HostId[] = []

  for (const id of selected) {
    const profile = profileById(id)!
    const status = integrationStatus(id, { home, paths, fileExists, runCommand })
    if (status === 'integrated') {
      out.push(`[${profile.label}] 已接入，跳过（幂等：文件与备份未改动）`)
      continue
    }
    // Profile-declared artifacts (e.g. built entry points) must exist first.
    if (profile.action.kind === 'json-merge') {
      const missing = (profile.action.requiredTokens ?? []).map((token) => resolveToken(token, paths)).filter((p) => !fileExists(p))
      if (missing.length) {
        out.push(`[${profile.label}] 缺少构建产物 ${missing.map((p) => basename(p)).join('、')}：请先在仓库运行 pnpm build`)
        failures.push(id)
        continue
      }
    }

    const plan = buildInitPlan(profile, { home, paths })
    if (plan.blocked) {
      out.push(`[${plan.label}] ${plan.blocked}`)
      failures.push(id)
      continue
    }
    if (plan.skipped) {
      out.push(`[${plan.label}] ${plan.skipped}`)
      continue
    }

    out.push(`[${plan.label}] 将执行：`)
    for (const step of plan.steps) out.push(`  · ${step.description}`)
    for (const line of plan.diff) out.push(`    ${line}`)
    if (!flags.yes) {
      if (!readLine) {
        out.push(`[${plan.label}] 需要确认但环境非交互：请加 --yes`)
        failures.push(id)
        continue
      }
      const answer = await readLine(`确认写入 ${plan.label}？(y/N)：`)
      if (!isConfirmed(answer)) {
        out.push(`[${plan.label}] 已跳过（未确认）`)
        continue
      }
    }

    const outcome = applyHostPlan(plan, { fileExists, runCommand })
    if (outcome.ok) {
      out.push(`[${plan.label}] 完成`)
      installed.push(id)
    } else {
      out.push(`[${plan.label}] 失败（步骤 ${outcome.failedStep}）：${outcome.error}`)
      failures.push(id)
    }
  }

  if (installed.length) {
    out.push('')
    out.push('安装完成：')
    for (const id of installed) {
      out.push(`  · ${profileById(id)!.label}（${profileById(id)!.sessionNote}）`)
    }
    out.push('验证：新开会话后运行 auto-guard guard status，或在宿主中执行一条命令观察审查提示')
    out.push('卸载：auto-guard remove [--host dsh,pi,zcode]')
    out.push('说明：守卫配置与数据在首次运行时播种到 ~/.<host>/auto-guard/，init 不创建这些文件')
  }
  if (failures.length) out.push(`有 ${failures.length} 个宿主未完成：${failures.join(', ')}`)
  return { code: failures.length ? 2 : 0, output: out }
}

function runList(flags: InstallerFlags, deps: InstallerDeps): InstallerResult {
  const out: string[] = []
  const home = resolveHome(flags, deps)
  const paths = resolvePaths(deps)
  const fileExists = deps.fileExists ?? existsSync
  const detections = detectHosts({ home, hasExecutable: deps.hasExecutable })
  for (const { profile, detected, evidence } of detections) {
    out.push(`[${profile.label}]`)
    out.push(`  检测: ${detected ? `是（${evidence.join('；')}）` : '否'}`)
    // An undetected host is by definition not integrated — don't confuse a
    // failing status probe (e.g. no dsh CLI) with "unknown, check manually".
    const status = detected ? integrationStatus(profile.id, { home, paths, fileExists, runCommand: deps.runCommand }) : 'not-integrated'
    out.push(`  接入: ${status === 'integrated' ? '已接入' : status === 'not-integrated' ? '未接入' : '未知（无法读取宿主配置）'}`)
    if (status === 'not-integrated') {
      out.push(`  下一步: ${detected ? `auto-guard init --host ${profile.id} --yes` : `先安装 ${profile.label}，再运行 auto-guard init --host ${profile.id} --yes`}`)
    } else if (status === 'integrated') {
      out.push('  验证: auto-guard guard status')
    } else {
      out.push('  请手工检查宿主配置文件后再操作')
    }
  }
  return { code: 0, output: out }
}

function runRemove(flags: InstallerFlags, deps: InstallerDeps): InstallerResult {
  const out: string[] = []
  const home = resolveHome(flags, deps)
  const fileExists = deps.fileExists ?? existsSync
  const hosts = flags.hosts?.length ? flags.hosts : [...HOST_IDS]
  const invalid = validateHostNames(hosts)
  if (invalid) return { code: 2, output: [invalid] }

  let failed = 0
  for (const id of orderedHosts(hosts)) {
    const profile = profileById(id)!
    const outcome = removeHost(profile, { home, fileExists, runCommand: deps.runCommand ?? defaultRunCommand })
    if (outcome.status === 'failed') failed++
    out.push(`[${profile.label}] ${outcome.message ?? (outcome.status === 'removed' || outcome.status === 'restored' ? '已卸载' : '未改动')}`)
  }
  out.push('说明：守卫用户数据 ~/.<host>/auto-guard/ 保留；如需彻底清除请手动删除对应目录')
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
