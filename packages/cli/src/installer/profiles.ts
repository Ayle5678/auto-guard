/**
 * Host profiles: the installer's data layer (ADR-0008).
 *
 * Each supported host is one declarative profile — detection evidence, the
 * file to touch and the content templates — so adding a host usually means
 * adding a profile (plus its @auto-guard/host-* adapter), not installer
 * logic. The one exception so far is a host needing a new KIND of write
 * (opencode's permission rules, ADR-0011): op kinds are closed here, and a
 * new kind touches plan/integration/remove/validate together by design.
 * Templates are JSON strings with ${TOKEN} placeholders resolved against the
 * discovered @auto-guard/host-* package locations; the installer only ever
 * touches files a profile declares.
 */
import { isMessageKey, message, type Lang, type MessageKey } from './i18n.ts'

export type HostId = 'dsh' | 'pi' | 'zcode' | 'claude' | 'opencode' | 'qoder'

export const HOST_IDS: readonly HostId[] = ['dsh', 'pi', 'zcode', 'claude', 'opencode', 'qoder']

/**
 * Entry templates: a fixed JSON string, or a per-language renderer (the
 * ZCode hook entries carry a localized `statusMessage`, so the template is
 * built in the language chosen at install time; ADR-0011).
 */
export type EntryTemplate = string | ((lang: Lang) => string)

/** Resolved locations of the adapter packages the profiles integrate. */
export interface PackagePaths {
  pi: { srcIndex: string }
  zcode: { distHookCli: string; distSessionStart: string }
  dsh: { packageDir: string }
  claude: { distHookCli: string; distSessionStart: string }
  opencode: { distPluginDir: string }
  qoder: { distHookCli: string; distSessionStart: string }
}

export interface DetectionSpec {
  /** HOME-relative directories suggesting the host, e.g. `.pi`. */
  dirs: string[]
  /** HOME-relative files — strongest evidence, e.g. `.zcode/cli/config.json`. */
  files: string[]
  /** Executables probed on PATH. */
  executables: string[]
}

/** Append one JSON element to the array at `arrayPath` (created when missing). */
export interface ArrayAppendOp {
  kind: 'array-append'
  /** Path of the target array inside the document, e.g. ['hooks', 'PreToolUse']. */
  arrayPath: string[]
  /** Fixed JSON template with ${TOKEN} placeholders, or a per-language renderer. */
  template: EntryTemplate
  /** Normalized (`/`-separated) suffix identifying "this entry is ours". */
  markerSuffix: string
}

/**
 * Insert `"*": "ask"` at the FIRST position of each tool object under
 * `permission` (ADR-0011): opencode's object syntax is last-matching-rule-
 * wins, so our catch-all must precede user rules, which then take priority.
 * Existing `"*"` keys are left untouched (idempotent no-op); remove never
 * deletes them (ownership cannot be distinguished — documented behavior).
 */
export interface PermissionAskRulesOp {
  kind: 'permission-ask-rules'
  /** Permission keys to guard, e.g. ['bash', 'edit', 'read']. */
  tools: string[]
  action: 'ask'
}

export type MergeOp = ArrayAppendOp | PermissionAskRulesOp

export interface JsonMergeAction {
  kind: 'json-merge'
  /** HOME-relative target file, e.g. `~/.pi/agent/settings.json`. */
  file: string
  /** Ordered writes applied to the document (array appends / permission rules). */
  ops: MergeOp[]
  /** Scalar assignments ensured before the ops run (e.g. ZCode's `hooks.enabled`, off by default). */
  ensure?: Array<{ path: string[]; value: unknown }>
  /** Arrays at these paths hold our entries from an older, wrong-location installer version; init/remove strip marker-matched elements and drop empties. */
  legacyCleanup?: Array<{ path: string[]; markerSuffix: string }>
  /** Tokens whose resolved paths must exist before writing (e.g. built dist entry points). */
  requiredTokens?: string[]
}

export interface CommandAction {
  kind: 'command'
  executable: string
  /** argv for install; may contain ${AUTO_GUARD_DSH_DIR}. */
  installArgs: string[]
  /** argv for uninstall. */
  removeArgs: string[]
  /** argv whose stdout reveals registered plugins (integration check). */
  listArgs: string[]
  pluginId: string
}

export interface HostProfile {
  id: HostId
  label: string
  detection: DetectionSpec
  /** HOME-relative auto-guard config root, mirroring the adapter's AUTO_GUARD_DIR (ADR-0003); the explicit rule-update step scans it (ADR-0013). */
  configRoot: string
  /** Init-summary note as an i18n key (hosts without hot reload say so here). */
  sessionNote: MessageKey
  /** Extra init-summary lines as i18n keys (warnings, verification hints). */
  postInstallNotes?: MessageKey[]
  action: JsonMergeAction | CommandAction
}

/** JSON-string-escape one value so it survives embedding in a JSON template. */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/** ZCode PreToolUse entry; the spinner statusMessage follows the install language. */
const zcodePreToolUseTemplate = (statusMessage: string): string =>
  `{"matcher":"^(Bash|Read|Write|Edit|ApplyPatch)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_HOOK_CLI}"],"timeoutMs":90000,"statusMessage":"${jsonEscape(statusMessage)}"}]}`

/** ZCode SessionStart entry; the spinner statusMessage follows the install language. */
const zcodeSessionStartTemplate = (statusMessage: string): string =>
  `{"matcher":"^(startup|resume)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_SESSION_START}"],"timeoutMs":10000,"statusMessage":"${jsonEscape(statusMessage)}"}]}`

// Claude Code settings.json hook dialect (code.claude.com/docs/en/hooks):
// handler type "command" with a single shell command string + timeout in
// SECONDS (zcode's "process"+args dialect is not valid here). The matcher is
// a JS regex because it contains non-alphanumeric characters; shell-form
// commands run under Git Bash on Windows, so quoted forward-slash paths work.
const CLAUDE_PRETOOLUSE_TEMPLATE = `{"matcher":"^(Bash|Read|Write|Edit|NotebookEdit)$","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_CLAUDE_HOOK_CLI}\\"","timeout":90}]}`
const CLAUDE_SESSIONSTART_TEMPLATE = `{"matcher":"^(startup|resume)$","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_CLAUDE_SESSION_START}\\"","timeout":30}]}`

// Qoder settings.json hook dialect (docs.qoder.com/extensions/hooks — the
// Claude-compatible one, unlike the CLI's nested decision.behavior form): the
// same "command" + timeout-SECONDS shape as Claude Code. Qoder names tools in
// two sets that both reach hooks (short Claude-style names and long internal
// names) plus the apply_patch edit alias; the matcher is the unanchored
// pipe list Qoder's own shipped guardrail matcher uses, which matches both
// pipe-split-exact and regex interpretations. International IDE only — the
// CN build (~/.qoder-cn) and the CLI entry point are out of scope (spec 0005).
// delete_file joins the guarded set in SPEC 0012 (synthesized to bash
// `rm "<path>"` in the adapter). Substring safety holds: no name in the list
// is a substring of another, so both matcher interpretations (pipe-split
// exact and regex substring) still hit exactly one tool per call.
const QODER_PRETOOLUSE_TEMPLATE = `{"matcher":"Bash|Read|Write|Edit|apply_patch|run_in_terminal|read_file|create_file|search_replace|delete_file","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_QODER_HOOK_CLI}\\"","timeout":90}]}`
const QODER_SESSIONSTART_TEMPLATE = `{"matcher":"startup|resume","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_QODER_SESSION_START}\\"","timeout":30}]}`

export const PROFILES: readonly HostProfile[] = [
  {
    id: 'dsh',
    configRoot: '.dsh/auto-guard',
    label: 'DeepSeek Harness',
    detection: { dirs: ['.dsh'], files: [], executables: ['dsh'] },
    sessionNote: 'sessionNoteReload',
    action: {
      kind: 'command',
      executable: 'dsh',
      // `dsh plugin` forwards to pnpm in a profile directory and demands its
      // own `--profile <name>` (a parent-level one is rejected); `web` is
      // dsh's default profile. `link:` installs a symlink so the adapter
      // resolves its `workspace:*` deps from the monorepo — a bare dir would
      // make pnpm pack it and fail on them. `ls <name>` filters by exact
      // dependency name, so the legacy standalone `dsh-auto-guard` plugin
      // can never pass for ours.
      installArgs: ['plugin', '--profile', 'web', 'add', 'link:${AUTO_GUARD_DSH_DIR}'],
      removeArgs: ['plugin', '--profile', 'web', 'remove', 'auto-guard'],
      listArgs: ['plugin', '--profile', 'web', 'ls', '--depth=0', 'auto-guard'],
      pluginId: 'auto-guard',
    },
  },
  {
    id: 'pi',
    configRoot: '.pi/auto-guard',
    label: 'Pi Coding Agent',
    detection: { dirs: ['.pi'], files: [], executables: ['pi'] },
    sessionNote: 'sessionNoteReload',
    action: {
      kind: 'json-merge',
      file: '~/.pi/agent/settings.json',
      ops: [
        {
          kind: 'array-append',
          arrayPath: ['pi', 'extensions'],
          template: '"${AUTO_GUARD_PI_INDEX}"',
          markerSuffix: '/host-pi/src/index.ts',
        },
      ],
    },
  },
  {
    id: 'zcode',
    configRoot: '.zcode/auto-guard',
    label: 'ZCode',
    detection: { dirs: ['.zcode'], files: ['.zcode/cli/config.json'], executables: [] },
    sessionNote: 'sessionNoteHooksNoHotReload',
    action: {
      kind: 'json-merge',
      file: '~/.zcode/cli/config.json',
      requiredTokens: ['${AUTO_GUARD_ZCODE_HOOK_CLI}', '${AUTO_GUARD_ZCODE_SESSION_START}'],
      // Configuration-file hooks live under `hooks.events.<Event>` in ZCode
      // (the outer `hooks` wrapper shape is plugin manifests only), and they
      // run only when `hooks.enabled` is true — ZCode rejects any other key
      // under `hooks`, so v0.3.0's flat `hooks.PreToolUse` entries both never
      // fired and invalidated the whole file; legacyCleanup reclaims them.
      ensure: [{ path: ['hooks', 'enabled'], value: true }],
      ops: [
        { kind: 'array-append', arrayPath: ['hooks', 'events', 'PreToolUse'], template: (lang) => zcodePreToolUseTemplate(message(lang, 'statusMessageReviewing')), markerSuffix: '/host-zcode/dist/hook-cli.js' },
        { kind: 'array-append', arrayPath: ['hooks', 'events', 'SessionStart'], template: (lang) => zcodeSessionStartTemplate(message(lang, 'statusMessageSessionInit')), markerSuffix: '/host-zcode/dist/session-start.js' },
      ],
      legacyCleanup: [
        { path: ['hooks', 'PreToolUse'], markerSuffix: '/host-zcode/dist/hook-cli.js' },
        { path: ['hooks', 'SessionStart'], markerSuffix: '/host-zcode/dist/session-start.js' },
      ],
    },
  },
  {
    id: 'claude',
    configRoot: '.claude/auto-guard',
    label: 'Claude Code',
    detection: { dirs: ['.claude'], files: ['.claude/settings.json'], executables: ['claude'] },
    sessionNote: 'sessionNoteClaudeHooksNoHotReload',
    postInstallNotes: ['claudeVerifyHint', 'claudeSwitcherRisk'],
    action: {
      kind: 'json-merge',
      file: '~/.claude/settings.json',
      requiredTokens: ['${AUTO_GUARD_CLAUDE_HOOK_CLI}', '${AUTO_GUARD_CLAUDE_SESSION_START}'],
      ops: [
        { kind: 'array-append', arrayPath: ['hooks', 'PreToolUse'], template: CLAUDE_PRETOOLUSE_TEMPLATE, markerSuffix: '/host-claude/dist/hook-cli.js' },
        { kind: 'array-append', arrayPath: ['hooks', 'SessionStart'], template: CLAUDE_SESSIONSTART_TEMPLATE, markerSuffix: '/host-claude/dist/session-start.js' },
      ],
    },
  },
  {
    id: 'opencode',
    configRoot: '.config/opencode/auto-guard',
    label: 'OpenCode',
    detection: { dirs: ['.config/opencode'], files: ['.config/opencode/opencode.json'], executables: ['opencode'] },
    sessionNote: 'sessionNoteOpencodePlugin',
    postInstallNotes: ['opencodeKeepAskNote', 'opencodeSessionAlwaysNote'],
    action: {
      kind: 'json-merge',
      file: '~/.config/opencode/opencode.json',
      requiredTokens: ['${AUTO_GUARD_OPENCODE_PLUGIN}'],
      ops: [
        { kind: 'array-append', arrayPath: ['plugin'], template: '"${AUTO_GUARD_OPENCODE_PLUGIN}"', markerSuffix: '/host-opencode/dist' },
        { kind: 'permission-ask-rules', tools: ['bash', 'edit', 'read'], action: 'ask' },
      ],
    },
  },
  {
    id: 'qoder',
    configRoot: '.qoder/auto-guard',
    label: 'Qoder',
    detection: { dirs: ['.qoder'], files: ['.qoder/settings.json'], executables: ['qoder'] },
    sessionNote: 'sessionNoteQoderHooksNoHotReload',
    postInstallNotes: ['qoderVerifyHint'],
    action: {
      kind: 'json-merge',
      file: '~/.qoder/settings.json',
      requiredTokens: ['${AUTO_GUARD_QODER_HOOK_CLI}', '${AUTO_GUARD_QODER_SESSION_START}'],
      ops: [
        { kind: 'array-append', arrayPath: ['hooks', 'PreToolUse'], template: QODER_PRETOOLUSE_TEMPLATE, markerSuffix: '/host-qoder/dist/hook-cli.js' },
        { kind: 'array-append', arrayPath: ['hooks', 'SessionStart'], template: QODER_SESSIONSTART_TEMPLATE, markerSuffix: '/host-qoder/dist/session-start.js' },
      ],
    },
  },
]

export function profileById(id: HostId): HostProfile | undefined {
  return PROFILES.find((p) => p.id === id)
}

/** Schema check for one profile; returns human-readable errors (empty = valid). Kind-based, so new hosts validate without editing this. */
export function validateProfile(profile: HostProfile): string[] {
  const errors: string[] = []
  if (!HOST_IDS.includes(profile.id)) errors.push(`id 必须是 ${HOST_IDS.join('|')} 之一`)
  if (!profile.label) errors.push('label 不能为空')
  const d = profile.detection
  if (!d || (!d.dirs?.length && !d.files?.length && !d.executables?.length)) errors.push('detection 需要至少一项证据（dirs/files/executables）')
  if (!profile.sessionNote) errors.push('sessionNote 不能为空')
  else if (!isMessageKey(profile.sessionNote)) errors.push(`sessionNote 必须是消息目录中的键：${profile.sessionNote}`)
  if (!profile.configRoot) errors.push('configRoot 不能为空（~/ 相对的 auto-guard 配置根）')
  if (!profile.action) {
    errors.push('action 不能为空')
    return errors
  }
  if (profile.action.kind === 'command') {
    const action = profile.action
    if (!action.executable) errors.push('command 动作缺少 executable')
    if (!action.installArgs.length) errors.push('command 动作缺少 installArgs')
    if (!action.removeArgs.length) errors.push('command 动作缺少 removeArgs')
    if (!action.listArgs.length) errors.push('command 动作缺少 listArgs')
    if (!action.pluginId) errors.push('command 动作缺少 pluginId')
  } else {
    const action = profile.action
    if (!action.file.startsWith('~/')) errors.push('目标文件必须是 ~/ 相对路径')
    if (!action.ops.length) errors.push('至少需要一个写入 op')
    for (const op of action.ops) {
      if (op.kind === 'permission-ask-rules') {
        if (!op.tools.length) errors.push('permission-ask-rules 缺少 tools')
        if (op.action !== 'ask') errors.push('permission-ask-rules 仅支持 action: ask')
        continue
      }
      if (!op.arrayPath.length) errors.push('op.arrayPath 不能为空')
      if (!op.template) errors.push('op.template 不能为空')
      if (!op.markerSuffix) errors.push('op.markerSuffix 不能为空')
    }
    for (const item of action.ensure ?? []) {
      if (!item.path.length) errors.push('ensure.path 不能为空')
      if (item.value === undefined) errors.push('ensure.value 不能为 undefined')
    }
    for (const item of action.legacyCleanup ?? []) {
      if (!item.path.length) errors.push('legacyCleanup.path 不能为空')
      if (!item.markerSuffix) errors.push('legacyCleanup.markerSuffix 不能为空')
      if (action.ops.some((op) => op.kind === 'array-append' && op.arrayPath.join('.') === item.path.join('.'))) errors.push(`legacyCleanup 与 op.arrayPath 重叠：${item.path.join('.')}`)
    }
    for (const token of action.requiredTokens ?? []) {
      if (!TOKENS[token]) errors.push(`requiredTokens 含未知 token：${token}`)
    }
  }
  return errors
}

interface TokenSpec {
  resolve: (paths: PackagePaths) => string
  /** Token value is embedded in a JSON template — escape for JSON.stringify. */
  json: boolean
}

/** Resolve one ${TOKEN} to its concrete path (validator rejects unknown tokens first). */
export function resolveToken(token: string, paths: PackagePaths): string {
  const spec = TOKENS[token]
  if (!spec) throw new Error(`未知 token：${token}`)
  return spec.resolve(paths)
}

const TOKENS: Record<string, TokenSpec> = {
  '${AUTO_GUARD_PI_INDEX}': { resolve: (paths) => paths.pi.srcIndex, json: true },
  '${AUTO_GUARD_ZCODE_HOOK_CLI}': { resolve: (paths) => paths.zcode.distHookCli, json: true },
  '${AUTO_GUARD_ZCODE_SESSION_START}': { resolve: (paths) => paths.zcode.distSessionStart, json: true },
  '${AUTO_GUARD_DSH_DIR}': { resolve: (paths) => paths.dsh.packageDir, json: false },
  '${AUTO_GUARD_CLAUDE_HOOK_CLI}': { resolve: (paths) => paths.claude.distHookCli, json: true },
  '${AUTO_GUARD_CLAUDE_SESSION_START}': { resolve: (paths) => paths.claude.distSessionStart, json: true },
  '${AUTO_GUARD_OPENCODE_PLUGIN}': { resolve: (paths) => paths.opencode.distPluginDir, json: true },
  '${AUTO_GUARD_QODER_HOOK_CLI}': { resolve: (paths) => paths.qoder.distHookCli, json: true },
  '${AUTO_GUARD_QODER_SESSION_START}': { resolve: (paths) => paths.qoder.distSessionStart, json: true },
}

/** Substitute ${TOKEN} placeholders; JSON-embedded values are escaped so native Windows paths survive JSON.parse. */
export function renderTemplate(template: string, paths: PackagePaths): string {
  let out = template
  for (const [token, spec] of Object.entries(TOKENS)) {
    const value = spec.resolve(paths)
    const rendered = spec.json ? JSON.stringify(value).slice(1, -1) : value
    out = out.replaceAll(token, rendered)
  }
  return out
}
