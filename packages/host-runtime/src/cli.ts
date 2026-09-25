/**
 * The single management-CLI engine (ADR-0022): dispatch, rendering, exit
 * codes and usage for the shared command syntax (guard/set/examine/optimize)
 * over the core operations layer (ADR-0009). Drivers declare their surface —
 * root-resolution mode, capability switches, output sink, usage program name
 * — and every shared action lives here exactly once.
 *
 * Secret handling: API keys are never accepted as argv (shell history would
 * capture them). The interactive `set set-key` wizard (capability-gated)
 * reads the key from a TTY with echo disabled and stores it AES-GCM-encrypted
 * (core key-store); the env var remains primary.
 *
 * Output language follows the four-layer resolution (ADR-0011): env >
 * config.lang > machine default > zh, resolved per command after its config
 * load (one command per process, so effectively once per process).
 *
 * Usage lines are engine-owned text parameterized by the program prefix;
 * every other wording key stays with the driver catalog until the guard
 * surface catalog unifies it (ADR-0023).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
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
  deletePendingAsk,
  DiskSessionCache,
  effectiveLang,
  envLang,
  examineStatusLines,
  hasStoredApiKey,
  hydrateApiKey,
  listPendingAsks,
  loadAnalyzeState,
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
  readRecentDecisions,
  recentLines,
  reportLines,
  resolveProcessLang,
  rollbackLearnedRules,
  saveApiKey,
  saveConfig,
  sessionMemoryEntry,
  setEnabled,
  statusLines,
  truncateOneLine,
  updateLastAnalysis,
  defaultGuardConfig,
  type AuditStore,
  type GuardConfig,
  type Lang,
  type LlmReviewer,
  type RulesFile,
  type RuntimeStatus,
} from '@auto-guard/core'

/** Lightweight connectivity check result (see core DeepSeekReviewer). */
export interface PingResult {
  ok: boolean
  error?: string
}

/** Reviewer with the optional connectivity check used by `guard ping`. */
export type PingableReviewer = LlmReviewer & { ping(): Promise<PingResult> }

/** One standard host data root: where the host's guard config is seeded. */
export interface HostRootRef {
  label: string
  /** Host home directory (e.g. `~/.pi`) — its existence means the host is installed. */
  homeDir: string
  /** Guard data root (e.g. `~/.pi/auto-guard`). */
  root: string
}

/**
 * The command-group switches a driver declares (ADR-0022): what one entry
 * can do today, the other gets byte-for-byte — never widened, never narrowed
 * — by flipping these instead of porting actions.
 */
export interface CliCapabilities {
  /** `guard ask` escape-hatch group (ADR-0019) — hook-host drivers. */
  ask?: boolean
  /** Interactive `set set-key` wizard; false → the TTY-refusal stub (exit 2). */
  setKeyWizard?: boolean
  /** Aggregate `guard status` across host roots for auto-detected roots. */
  aggregateStatus?: boolean
  /** `guard status` counts audit rows while examine is on. */
  statusAuditCount?: boolean
  /** `optimize analyze` refuses while examine is off (exit 2). */
  analyzeRequiresExamine?: boolean
  /** `optimize analyze` records the last-analysis timestamp on success. */
  analyzeMarksState?: boolean
  /** `optimize auto` prints the dedicated unsupported notice; false → group usage. */
  optimizeAutoNotice?: boolean
}

/**
 * Root resolution mode (ADR-0022): the unified CLI auto-detects (flag → env →
 * detection, with the installer groups dispatching before any root exists);
 * hook-host drivers pin the descriptor's config root.
 */
export type CliRootSource =
  | { mode: 'pinned'; root: string }
  | {
      mode: 'auto'
      /** Explicit root from the environment (`AUTO_GUARD_CONFIG_ROOT`). */
      envRoot?: () => string | undefined
      /** Auto-detection when no flag/env root; absent/miss → `noRootFound`, exit 2. */
      detect?: () => string | undefined
      /** Host roots scanned by the aggregate `guard status` view. */
      hostRoots?: () => readonly HostRootRef[]
      /** Installer groups (init/list/remove); dispatch before root resolution. */
      installer?: (argv: readonly string[]) => { code: number; output: string[] } | Promise<{ code: number; output: string[] }>
      /** Environment override for language resolution (tests). */
      env?: Record<string, string | undefined>
      /** Machine-default config path override (tests). */
      machineLangPath?: string
    }

export interface CliParts {
  /** Usage-text program prefix (`auto-guard` vs `node dist/cli.js`). */
  programName: string
  /**
   * Driver message catalog lookup. The key set is the engine's union; a
   * driver's catalog only needs the keys its capabilities can reach —
   * capability gating keeps the untyped key honest.
   */
  message: (lang: Lang, key: string, params?: Record<string, string | number>) => string
  /** Output sink (injectable for tests); default process.stdout. */
  writeOut?: (text: string) => void
  /** Declared command-group switches. */
  capabilities: CliCapabilities
  root: CliRootSource
  /** Reviewer override for `guard ping` (tests). */
  makeReviewer?: (config: GuardConfig) => PingableReviewer
  /** Audit-store override (tests); default `createAuditStore(dbPath, loadAuditPassword(root))`. */
  makeAudit?: (root: string, config: GuardConfig) => AuditStore
  /** `optimize analyze` runtime assembly (hook-host kit bootstrap); default = direct load from the root. */
  optimizeRuntime?: () => { config: GuardConfig; rules: RulesFile; audit: AuditStore }
}

interface Ctx {
  root: string
  /** True when the root came from `--config-root`/env — aggregate views stay off. */
  explicitRoot: boolean
}

/** Build the CLI entry for one driver (argv excludes the binary name). */
export function createCliMain(parts: CliParts): (argv: readonly string[]) => Promise<number> {
  const emit = (message: string): void => {
    ;(parts.writeOut ?? ((text: string) => process.stdout.write(`${text}\n`)))(message)
  }

  /** Four-layer language resolution (env > config.lang > machine default > zh), once per command. */
  function resolveLang(configLang?: Lang): Lang {
    if (parts.root.mode === 'pinned') return resolveProcessLang(configLang)
    return effectiveLang({
      env: envLang(parts.root.env ?? process.env),
      configLang,
      machineLang: readMachineLang(parts.root.machineLangPath ?? machineConfigPath(homedir())),
    })
  }

  /** Status display path: the unified CLI shows the native join shape, the runtime its template literal. */
  function configPathLabelOf(root: string): string {
    return parts.root.mode === 'pinned' ? `${root}/config.json` : join(root, 'config.json')
  }

  /** Usage lines are engine-owned text, parameterized by the program prefix. */
  function usageText(key: 'usage' | 'guardUsage' | 'askUsage' | 'setUsage' | 'examineUsage' | 'optimizeUsage', lang: Lang): string {
    const p = parts.programName
    const zh = lang === 'zh'
    const colon = zh ? '用法：' : 'Usage: '
    const ask = parts.capabilities.ask ? '|ask' : ''
    switch (key) {
      case 'usage':
        if (parts.root.mode === 'auto') {
          return zh
            ? `${colon}${p} <init|list|remove|guard|set|examine|optimize> …（init/list/remove 为安装器；可选 --config-root <path>）`
            : `${colon}${p} <init|list|remove|guard|set|examine|optimize> … (init/list/remove are the installer; optional --config-root <path>)`
        }
        return `${colon}${p} <guard|set|examine|optimize> <action>`
      case 'guardUsage':
        return `${colon}${p} guard <on|off|status|recent|stats|report|ping${ask}>`
      case 'askUsage':
        return zh
          ? `${colon}${p} guard ask <list | allow <序号> | deny <序号> [--reason <理由>]>`
          : `${colon}${p} guard ask <list | allow <index> | deny <index> [--reason <text>]>`
      case 'setUsage':
        return `${colon}${p} set <set-key|show-key|clear-key|set-api|lang|history|reload>`
      case 'examineUsage':
        return `${colon}${p} examine <on|off|status|clear-old|clear-all>`
      case 'optimizeUsage':
        return `${colon}${p} optimize <status|analyze [--full]|list|rollback>`
    }
  }

  function usageExit(key: 'guardUsage' | 'askUsage' | 'setUsage' | 'examineUsage' | 'optimizeUsage', lang: Lang): number {
    emit(usageText(key, lang))
    return 1
  }

  /** Load, save and audit access, all rooted at the given config root. */
  function openRoot(root: string) {
    const configPath = join(root, 'config.json')
    return {
      load: () => loadConfig(configPath, defaultGuardConfig(root)),
      save: (config: GuardConfig) => saveConfig(config, configPath),
      auditFor: (config: GuardConfig): AuditStore =>
        parts.makeAudit ? parts.makeAudit(root, config) : createAuditStore(config.auditDbPath, loadAuditPassword(root)),
    }
  }

  /** Best-effort status snapshot stored by the host hook at `<root>/status.json`; missing/corrupt reads as empty. */
  function readStatusFile(root: string): RuntimeStatus {
    try {
      const parsed = JSON.parse(readFileSync(join(root, 'status.json'), 'utf8')) as RuntimeStatus
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  async function main(argv: readonly string[]): Promise<number> {
    if (parts.root.mode === 'auto') {
      // Strip the shared config-root flag first so `--config-root X init`
      // still dispatches; the installer accepts and ignores the flag
      // (spec 0002: the guard config root is not the installer's business).
      let args = [...argv]
      let root = ''
      let explicitRoot = false
      const rootIndex = args.indexOf('--config-root')
      if (rootIndex >= 0) {
        root = args[rootIndex + 1] ?? ''
        args = [...args.slice(0, rootIndex), ...args.slice(rootIndex + 2)]
        explicitRoot = root !== ''
      } else if (parts.root.envRoot?.()) {
        root = parts.root.envRoot()!
        explicitRoot = true
      }

      // Installer commands run before config-root resolution: installing must
      // work on machines where no auto-guard config root exists yet (SPEC 0002).
      if (args.length && parts.root.installer) {
        const [group] = args
        if (group === 'init' || group === 'list' || group === 'remove') {
          const result = await parts.root.installer(args)
          for (const line of result.output) emit(line)
          return result.code
        }
      }

      if (!root) {
        const detected = parts.root.detect?.()
        if (!detected) {
          emit(parts.message(resolveLang(), 'noRootFound'))
          return 2
        }
        root = detected
      }
      return dispatch(args, { root, explicitRoot })
    }

    return dispatch(argv, { root: parts.root.root, explicitRoot: true })
  }

  function dispatch(args: readonly string[], ctx: Ctx): number | Promise<number> {
    const [group, action = '', ...rest] = args
    switch (group) {
      case 'guard':
        return guardCommand(action, rest, ctx)
      case 'set':
        return setCommand(action, rest, ctx.root)
      case 'examine':
        return examineCommand(action, ctx.root)
      case 'optimize':
        return optimizeCommand(action, rest, ctx.root)
      default:
        emit(usageText('usage', resolveLang()))
        return 1
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
  function aggregateStatusLines(): string[] {
    const roots = parts.root.mode === 'auto' ? (parts.root.hostRoots?.() ?? []) : []
    const viewLang = resolveLang()
    const lines: string[] = [parts.message(viewLang, 'aggregateHeader')]
    for (const { label, homeDir, root } of roots) {
      if (!existsSync(homeDir)) continue
      lines.push('')
      if (!existsSync(root)) {
        const hostName = label.replace(/ Coding Agent$/, '')
        lines.push(parts.message(viewLang, 'aggregateUnseeded', { label, root: tildePath(root), host: hostName }))
        continue
      }
      lines.push(`🛡️ ${label} — ${tildePath(root)}`)
      const io = openRoot(root)
      const config = io.load()
      const lang = resolveLang(config.lang)
      let auditCount: number | undefined
      if (config.examineEnabled) {
        const audit = io.auditFor(config)
        try {
          auditCount = audit.count()
        } finally {
          audit.close()
        }
      }
      for (const line of statusLines(config, readStatusFile(root), join(root, 'config.json'), auditCount, lang)) {
        lines.push(`  ${line}`)
      }
    }
    lines.push('')
    lines.push(parts.message(viewLang, 'aggregateFooter'))
    return lines
  }

  function guardCommand(action: string, rest: readonly string[], ctx: Ctx): number | Promise<number> {
    // Aggregate view goes first so an unseeded auto-detected root is not
    // created as a side effect of reading status (io.load() seeds defaults).
    if (action === 'status' && !ctx.explicitRoot && parts.capabilities.aggregateStatus) {
      emit(aggregateStatusLines().join('\n'))
      return 0
    }
    // Read-only group: hydrate the encrypted key so status/ping see it.
    const io = openRoot(ctx.root)
    const config = hydrateApiKey(io.load(), () => loadApiKey(ctx.root))
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'on':
      case 'off': {
        emit(setEnabled(config, action === 'on', lang))
        io.save(config)
        return 0
      }
      case 'ask': {
        if (!parts.capabilities.ask) return usageExit('guardUsage', lang)
        return askCommand(rest, config, lang, ctx.root)
      }
      case 'status': {
        let auditCount: number | undefined
        if (config.examineEnabled && parts.capabilities.statusAuditCount) {
          const audit = io.auditFor(config)
          try {
            auditCount = audit.count()
          } finally {
            audit.close()
          }
        }
        emit(statusLines(config, readStatusFile(ctx.root), configPathLabelOf(ctx.root), auditCount, lang).join('\n'))
        return 0
      }
      case 'recent': {
        const count = Number(rest[0]) > 0 ? Number(rest[0]) : 10
        emit(recentLines(readRecentDecisions(count, join(ctx.root, 'decision-history.jsonl')), count, lang).join('\n'))
        return 0
      }
      case 'stats': {
        if (config.examineEnabled) {
          const audit = io.auditFor(config)
          try {
            emit(parts.message(lang, 'statsAuditCount', { count: audit.count() }))
          } finally {
            audit.close()
          }
        } else {
          emit(parts.message(lang, 'statsExamineOff'))
        }
        return 0
      }
      case 'report': {
        const days = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : 7
        if (!config.examineEnabled) {
          emit(parts.message(lang, 'statsExamineOff'))
          return 0
        }
        const audit = io.auditFor(config)
        try {
          emit(reportLines(audit.summarizeSince(days), days, lang).join('\n'))
        } finally {
          audit.close()
        }
        return 0
      }
      case 'ping': {
        const reviewer = parts.makeReviewer ? parts.makeReviewer(config) : new DeepSeekReviewer(config, lang)
        return reviewer.ping().then((result) => {
          emit(result.ok ? parts.message(lang, 'pingOk') : parts.message(lang, 'pingFail', { error: result.error ?? parts.message(lang, 'unknownError') }))
          return result.ok ? 0 : 2
        })
      }
      default:
        return usageExit('guardUsage', lang)
    }
  }

  /**
   * `guard ask` — the ADR-0019 escape hatch: resolve the pending asks the hook
   * recorded into the session cache, so the SAME command stops asking for the
   * rest of the session. deny's reason travels to the model on every repeat.
   */
  function askCommand(rest: readonly string[], config: GuardConfig, lang: Lang, root: string): number {
    const sub = rest[0] ?? 'list'
    const sessionsDir = join(root, 'sessions')
    if (sub === 'list') {
      const entries = listPendingAsks(sessionsDir)
      if (!entries.length) {
        emit(parts.message(lang, 'askListEmpty'))
        return 0
      }
      const rows = entries.map((entry, index) =>
        parts.message(lang, 'askRow', {
          index: index + 1,
          time: localTimestamp(entry.record.askedAt),
          command: truncateOneLine(entry.record.command, 80),
          risk: entry.record.risk ?? '-',
          workspace: truncateOneLine(entry.record.workspace ?? '-', 40),
        }),
      )
      emit([parts.message(lang, 'askListHeader', { count: entries.length }), ...rows].join('\n'))
      return 0
    }
    if (sub === 'allow' || sub === 'deny') {
      const value = rest[1]
      const index = Number(value)
      if (!Number.isInteger(index) || index < 1) {
        emit(parts.message(lang, 'askInvalidIndex', { value: value ?? '' }))
        return 1
      }
      const entries = listPendingAsks(sessionsDir)
      const entry = entries[index - 1]
      if (!entry) {
        emit(parts.message(lang, 'askStaleIndex', { index }))
        return 2
      }
      const reason = sub === 'deny' ? reasonFrom(rest) : undefined
      const dir = join(sessionsDir, entry.dirName)
      // The exact entry a pi four-state choice writes: alive until session end.
      new DiskSessionCache(dir, config.sessionCacheSize).set(entry.record.key, sessionMemoryEntry(sub === 'allow' ? 'allow' : 'deny', reason))
      deletePendingAsk(dir, entry.record.key)
      if (sub === 'allow') {
        emit(parts.message(lang, 'askResolvedAllow', { command: truncateOneLine(entry.record.command, 80) }))
      } else if (reason) {
        emit(parts.message(lang, 'askResolvedDenyWithReason', { command: truncateOneLine(entry.record.command, 80), reason }))
      } else {
        emit(parts.message(lang, 'askResolvedDeny', { command: truncateOneLine(entry.record.command, 80) }))
      }
      return 0
    }
    return usageExit('askUsage', lang)
  }

  /** `--reason <text>` (everything after the flag, joined); absent/empty → undefined. */
  function reasonFrom(rest: readonly string[]): string | undefined {
    const flag = rest.indexOf('--reason')
    if (flag < 0) return undefined
    return (
      rest
        .slice(flag + 1)
        .join(' ')
        .trim() || undefined
    )
  }

  /** Local `MM-DD HH:MM:SS` — pending asks live at most a day, but midnight exists. */
  function localTimestamp(t: number): string {
    const d = new Date(t)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  function setCommand(action: string, rest: readonly string[], root: string): number | Promise<number> {
    const io = openRoot(root)
    const config = io.load()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'set-key':
        if (!parts.capabilities.setKeyWizard) {
          emit(parts.message(lang, 'setKeyNeedsTty'))
          return 2
        }
        return setKeyInteractive(config, lang, root)
      case 'show-key': {
        const env = parts.root.mode === 'auto' ? (parts.root.env ?? process.env) : process.env
        const envSet = Boolean(env[config.apiKeyEnv])
        // Both placeholder names carry the same root so either catalog wording renders.
        emit(
          [
            parts.message(lang, envSet ? 'showKeyEnvSet' : 'showKeyEnvUnset', { name: config.apiKeyEnv }),
            hasStoredApiKey(root) ? parts.message(lang, 'showKeyStored', { root, dir: root }) : parts.message(lang, 'showKeyNoStore'),
            config.apiKey && !config.apiKey.startsWith('v1:')
              ? parts.message(lang, 'showKeyLegacy', { key: maskKey(config.apiKey) })
              : parts.message(lang, 'showKeyNoLegacy'),
          ].join('\n'),
        )
        return 0
      }
      case 'clear-key': {
        clearApiKey(root)
        emit(parts.message(lang, 'clearKeyDone'))
        return 0
      }
      case 'set-api': {
        // `set-api reset` restores the unified CLI's freshly loaded config,
        // the runtime its pristine descriptor defaults — today's difference.
        const defaults = parts.root.mode === 'auto' ? io.load() : defaultGuardConfig(root)
        const result = applySetApi(config, rest[0], rest[1], defaults, lang)
        if (result.ok) io.save(config)
        emit(result.message)
        return result.ok ? 0 : 1
      }
      case 'lang': {
        const result = applySetLang(config, rest[0])
        if (!result.ok || !result.lang) {
          emit(parts.message(lang, 'setLangInvalid', { value: rest[0] ?? '' }))
          return 1
        }
        io.save(config)
        // Receipt in the newly selected language: immediate proof the setting took effect.
        emit(parts.message(result.lang, 'setLangDone', { lang: result.lang }))
        return 0
      }
      case 'history': {
        const result = applyHistoryToggle(config, rest[0], lang)
        if (result.ok) io.save(config)
        emit(result.messages.join('\n'))
        return result.ok ? 0 : 1
      }
      case 'reload':
        // Kept for muscle-memory parity; hooks re-read on every process.
        emit(parts.message(lang, 'reloadNote'))
        return 0
      default:
        return usageExit('setUsage', lang)
    }
  }

  function examineCommand(action: string, root: string): number {
    const io = openRoot(root)
    const config = io.load()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'on': {
        config.examineEnabled = true
        io.save(config)
        emit(parts.message(lang, 'examineOn'))
        return 0
      }
      case 'off': {
        config.examineEnabled = false
        io.save(config)
        emit(parts.message(lang, 'examineOff'))
        return 0
      }
      case 'status': {
        emit(examineStatusLines(config).join('\n'))
        return 0
      }
      case 'clear-old':
      case 'clear-all': {
        const audit = io.auditFor(config)
        try {
          if (action === 'clear-old') {
            emit(parts.message(lang, 'examineClearedOld', { count: audit.clearOld(30) }))
          } else {
            audit.clearAll()
            emit(parts.message(lang, 'examineClearedAll'))
          }
        } finally {
          audit.close()
        }
        return 0
      }
      default:
        return usageExit('examineUsage', lang)
    }
  }

  function optimizeCommand(action: string, rest: readonly string[], root: string): number {
    const io = openRoot(root)
    const config = io.load()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'status': {
        emit(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt, lang).join('\n'))
        return 0
      }
      case 'analyze': {
        if (parts.capabilities.analyzeRequiresExamine && !config.examineEnabled) {
          emit(coreMessage(lang, 'analyzeNeedsExamine'))
          return 2
        }
        const runtime =
          parts.optimizeRuntime?.() ??
          (() => {
            const loaded = io.load()
            const rules = loadRules(loaded.rulesPath, loaded.defaultRulesPath)
            return { config: loaded, rules, audit: io.auditFor(loaded) }
          })()
        try {
          const result = analyzeLearnedRules({ config: runtime.config, rules: runtime.rules, audit: runtime.audit }, lang, { full: rest.includes('--full') })
          emit(result.message)
          if (result.ok && parts.capabilities.analyzeMarksState) updateLastAnalysis(config.analyzeStatePath)
          return result.ok ? 0 : 2
        } finally {
          runtime.audit.close()
        }
      }
      case 'auto': {
        if (!parts.capabilities.optimizeAutoNotice) return usageExit('optimizeUsage', lang)
        emit(parts.message(lang, 'optimizeAutoUnsupported'))
        return 1
      }
      case 'list': {
        emit(optimizeListLines(loadLearnedRules(config.learnedRulesPath), lang).join('\n'))
        return 0
      }
      case 'rollback': {
        const result = rollbackLearnedRules(config, lang)
        emit(result.message)
        return result.ok ? 0 : 2
      }
      default:
        return usageExit('optimizeUsage', lang)
    }
  }

  /**
   * Interactive `set set-key`: a three-step wizard — review endpoint base URL,
   * model name, then the API key (echo disabled). Each step accepts Enter to
   * keep the current value. The key never passes through argv or the chat.
   */
  async function setKeyInteractive(config: GuardConfig, lang: Lang, root: string): Promise<number> {
    if (!process.stdin.isTTY) {
      emit(parts.message(lang, 'setKeyNeedsTty'))
      return 2
    }
    if (process.env[config.apiKeyEnv]) {
      emit(parts.message(lang, 'setKeyEnvWarning', { name: config.apiKeyEnv }))
    }

    // Steps 1-2 are not secrets: plain readline with echo.
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer)))
    emit(parts.message(lang, 'wizardBanner'))
    const baseAnswer = (await ask(parts.message(lang, 'wizardBasePrompt', { base: config.apiBase }))).trim().replace(/\/+$/, '')
    const modelAnswer = (await ask(parts.message(lang, 'wizardModelPrompt', { model: config.model }))).trim()
    rl.close()

    if (baseAnswer && !/^https?:\/\//.test(baseAnswer)) {
      emit(parts.message(lang, 'wizardInvalidBase', { value: baseAnswer }))
      return 2
    }

    // Step 3 is the secret: raw-mode hidden read.
    const key = await readHidden(parts.message(lang, 'wizardKeyPrompt'))
    if (key === undefined) {
      emit(parts.message(lang, 'wizardCancelled'))
      return 2
    }
    const trimmed = key.trim()
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      emit(parts.message(lang, 'wizardInvalidKey'))
      return 2
    }

    let endpointChanged = false
    if (baseAnswer && baseAnswer !== config.apiBase) {
      config.apiBase = baseAnswer
      endpointChanged = true
    }
    if (modelAnswer && modelAnswer !== config.model) {
      config.model = modelAnswer
      config.fallbackModel = modelAnswer
      endpointChanged = true
    }
    if (endpointChanged) openRoot(root).save(config)

    saveApiKey(root, trimmed)
    emit('')
    emit(parts.message(lang, 'wizardSaved', { base: config.apiBase, model: config.model, key: maskKey(trimmed) }))
    emit(parts.message(lang, 'wizardSavedHint'))
    return 0
  }

  return main
}

function readHidden(prompt: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    let buffer = ''
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8')
      if (char === '\r' || char === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolve(buffer)
      } else if (char === '\u0003') {
        cleanup()
        process.stdout.write('\n')
        resolve(undefined)
      } else if (char === '\u007f' || char === '\b') {
        buffer = buffer.slice(0, -1)
      } else if (char >= ' ' && char <= '~') {
        buffer += char
      }
      // Non-printable bytes are ignored; keys are ASCII.
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}
