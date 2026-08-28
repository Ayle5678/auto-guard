/**
 * Unified management CLI shell (ADR-0009 terminal half).
 *
 * Argument parsing, table rendering and TTY interaction over the shared core
 * operations layer. I/O-producing collaborators (reviewer, audit store) are
 * injectable so integration tests run with fakes and no network or real
 * SQLite. Windows discipline: natural exit, set-key requires a real TTY,
 * exit codes 0/2.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeLearnedRules,
  applyHistoryToggle,
  applySetApi,
  clearApiKey,
  createAuditStore,
  DeepSeekReviewer,
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
  maskKey,
  optimizeListLines,
  optimizeStatusLines,
  recentLines,
  rollbackLearnedRules,
  saveApiKey,
  saveConfig,
  setEnabled,
  statusLines,
  type AuditStore,
  type GuardConfig,
  type LlmReviewer,
} from '@auto-guard/core'
import { readRecentDecisions, readStatus } from './status-store.ts'

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
}

export interface RunResult {
  code: number
  output: string[]
}

interface Ctx {
  out: string[]
  configRoot: string
  configPath: string
}

function detectConfigRoot(): string | undefined {
  const home = homedir()
  for (const dir of ['.zcode', '.pi', '.dsh']) {
    if (existsSync(join(home, dir))) return join(home, dir, 'auto-guard')
  }
  return undefined
}

function resolveConfigRoot(deps: CliDeps): string | undefined {
  if (deps.detectRoot) return deps.detectRoot()
  return detectConfigRoot()
}

/** Load, save and audit access, all rooted at the resolved config root. */
function openRoot(configRoot: string, deps: CliDeps) {
  const configPath = join(configRoot, 'config.json')
  return {
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
  let configRoot = ''
  const rootIndex = args.indexOf('--config-root')
  if (rootIndex >= 0) {
    configRoot = args[rootIndex + 1] ?? ''
    args = [...args.slice(0, rootIndex), ...args.slice(rootIndex + 2)]
  } else if (process.env.AUTO_GUARD_CONFIG_ROOT) {
    configRoot = process.env.AUTO_GUARD_CONFIG_ROOT
  } else {
    const detected = resolveConfigRoot(deps)
    if (!detected) {
      out.push('未找到宿主配置根；请用 --config-root <path> 指定（例如 ~/.zcode/auto-guard）')
      return { code: 2, output: out }
    }
    configRoot = detected
  }

  const [group, action = '', ...rest] = args
  const io = openRoot(configRoot, deps)
  const ctx: Ctx = { out, configRoot, configPath: join(configRoot, 'config.json') }

  switch (group) {
    case 'guard':
      return guardCommand(action, rest, ctx, io, deps)
    case 'set':
      return setCommand(action, rest, ctx, io)
    case 'examine':
      return examineCommand(action, ctx, io)
    case 'optimize':
      return optimizeCommand(action, ctx, io)
    default:
      out.push('用法：auto-guard <guard|set|examine|optimize> <action>（可选 --config-root <path>）')
      return { code: 1, output: out }
  }
}

function guardCommand(
  action: string,
  rest: readonly string[],
  ctx: Ctx,
  io: ReturnType<typeof openRoot>,
  deps: CliDeps,
): RunResult | Promise<RunResult> {
  // Read-only group: hydrate the encrypted key so status/ping see it.
  const config = hydrateApiKey(io.load(), () => loadApiKey(ctx.configRoot))
  switch (action) {
    case 'on':
    case 'off': {
      ctx.out.push(setEnabled(config, action === 'on'))
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
      ctx.out.push(statusLines(config, readStatus(join(ctx.configRoot, 'status.json')), ctx.configPath, auditCount).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'recent': {
      const count = Number(rest[0]) > 0 ? Number(rest[0]) : 10
      ctx.out.push(recentLines(readRecentDecisions(count, join(ctx.configRoot, 'decision-history.jsonl')), count).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'stats': {
      if (config.examineEnabled) {
        const audit = io.auditFor(config)
        try {
          ctx.out.push(`审计库记录总数：${audit.count()}（学习分析数据源）`)
        } finally {
          audit.close()
        }
      } else {
        ctx.out.push('审查日志未开启（auto-guard examine on 后才有持久统计）')
      }
      return { code: 0, output: ctx.out }
    }
    case 'ping': {
      const reviewer: PingableReviewer = deps.makeReviewer ? deps.makeReviewer(config) : new DeepSeekReviewer(config)
      return reviewer.ping().then((result) => {
        ctx.out.push(result.ok ? 'API 联通成功' : `API 联通失败：${result.error ?? '未知错误'}`)
        return { code: result.ok ? 0 : 2, output: ctx.out }
      })
    }
    default:
      ctx.out.push('用法：auto-guard guard <on|off|status|recent|stats|ping>')
      return { code: 1, output: ctx.out }
  }
}

function setCommand(action: string, rest: readonly string[], ctx: Ctx, io: ReturnType<typeof openRoot>): RunResult {
  const config = io.load()
  switch (action) {
    case 'set-key':
      ctx.out.push('set set-key 需要交互式终端（IDE 内置终端即可）。请不要把 Key 粘贴到对话中——那会进入会话日志。')
      return { code: 2, output: ctx.out }
    case 'show-key': {
      const envSet = Boolean(process.env[config.apiKeyEnv])
      ctx.out.push(
        [
          `env ${config.apiKeyEnv}: ${envSet ? '已设置（优先于本地存储）' : '未设置'}`,
          `stored     : ${hasStoredApiKey(ctx.configRoot) ? `已存储（AES-GCM 加密于 ${ctx.configRoot}/api-key.json）` : '(未存储)'}`,
          `legacy     : ${config.apiKey && !config.apiKey.startsWith('v1:') ? `${maskKey(config.apiKey)}（config.json 明文遗留，建议 set-key 重存）` : '(无)'}`,
        ].join('\n'),
      )
      return { code: 0, output: ctx.out }
    }
    case 'clear-key': {
      clearApiKey(ctx.configRoot)
      ctx.out.push('已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）')
      return { code: 0, output: ctx.out }
    }
    case 'set-api': {
      const result = applySetApi(config, rest[0], rest[1], io.load())
      if (result.ok) io.save(config)
      ctx.out.push(result.message)
      return { code: result.ok ? 0 : 1, output: ctx.out }
    }
    case 'history': {
      const result = applyHistoryToggle(config, rest[0])
      if (result.ok) io.save(config)
      ctx.out.push(result.messages.join('\n'))
      return { code: result.ok ? 0 : 1, output: ctx.out }
    }
    case 'reload':
      ctx.out.push('配置与规则在每次 hook 进程启动时自动重读')
      return { code: 0, output: ctx.out }
    default:
      ctx.out.push('用法：auto-guard set <set-key|show-key|clear-key|set-api|history|reload>')
      return { code: 1, output: ctx.out }
  }
}

function examineCommand(action: string, ctx: Ctx, io: ReturnType<typeof openRoot>): RunResult {
  const config = io.load()
  switch (action) {
    case 'on': {
      config.examineEnabled = true
      io.save(config)
      ctx.out.push('审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）')
      return { code: 0, output: ctx.out }
    }
    case 'off': {
      config.examineEnabled = false
      io.save(config)
      ctx.out.push('审查日志已关闭')
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
          ctx.out.push(`已删除 ${audit.clearOld(30)} 条 30 天前记录`)
        } else {
          audit.clearAll()
          ctx.out.push('已清空全部审查日志')
        }
      } finally {
        audit.close()
      }
      return { code: 0, output: ctx.out }
    }
    default:
      ctx.out.push('用法：auto-guard examine <on|off|status|clear-old|clear-all>')
      return { code: 1, output: ctx.out }
  }
}

function optimizeCommand(action: string, ctx: Ctx, io: ReturnType<typeof openRoot>): RunResult {
  const config = io.load()
  switch (action) {
    case 'status': {
      ctx.out.push(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'analyze': {
      if (!config.examineEnabled) {
        ctx.out.push('请先开启审查日志（examine on）再分析')
        return { code: 2, output: ctx.out }
      }
      const audit = io.auditFor(config)
      try {
        const rules = loadRules(config.rulesPath, config.defaultRulesPath)
        const result = analyzeLearnedRules({ config, rules, audit })
        ctx.out.push(result.message)
        return { code: result.ok ? 0 : 2, output: ctx.out }
      } finally {
        audit.close()
      }
    }
    case 'list': {
      ctx.out.push(optimizeListLines(loadLearnedRules(config.learnedRulesPath)).join('\n'))
      return { code: 0, output: ctx.out }
    }
    case 'rollback': {
      const result = rollbackLearnedRules(config)
      ctx.out.push(result.message)
      return { code: result.ok ? 0 : 2, output: ctx.out }
    }
    default:
      ctx.out.push('用法：auto-guard optimize <status|analyze|list|rollback>')
      return { code: 1, output: ctx.out }
  }
}
