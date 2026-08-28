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
export type HostId = 'dsh' | 'pi' | 'zcode' | 'claude' | 'opencode'

export const HOST_IDS: readonly HostId[] = ['dsh', 'pi', 'zcode', 'claude', 'opencode']

/** Resolved locations of the adapter packages the profiles integrate. */
export interface PackagePaths {
  pi: { srcIndex: string }
  zcode: { distHookCli: string; distSessionStart: string }
  dsh: { packageDir: string }
  claude: { distHookCli: string; distSessionStart: string }
  opencode: { distPluginDir: string }
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
  /** JSON template with ${TOKEN} placeholders. */
  template: string
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
  /** Session-note shown in the init summary (hosts without hot reload say so here). */
  sessionNote: string
  /** Extra lines appended to the init summary (warnings, verification hints). */
  postInstallNotes?: string[]
  action: JsonMergeAction | CommandAction
}

const ZCODE_PRETOOLUSE_TEMPLATE = `{"matcher":"^(Bash|Read|Write|Edit|ApplyPatch)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_HOOK_CLI}"],"timeoutMs":90000,"statusMessage":"🛡️ auto-guard 安全审查中…"}]}`
const ZCODE_SESSIONSTART_TEMPLATE = `{"matcher":"^(startup|resume)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_SESSION_START}"],"timeoutMs":10000,"statusMessage":"🛡️ auto-guard 会话初始化"}]}`

// Claude Code settings.json hook dialect (code.claude.com/docs/en/hooks):
// handler type "command" with a single shell command string + timeout in
// SECONDS (zcode's "process"+args dialect is not valid here). The matcher is
// a JS regex because it contains non-alphanumeric characters; shell-form
// commands run under Git Bash on Windows, so quoted forward-slash paths work.
const CLAUDE_PRETOOLUSE_TEMPLATE = `{"matcher":"^(Bash|Read|Write|Edit|NotebookEdit)$","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_CLAUDE_HOOK_CLI}\\"","timeout":90}]}`
const CLAUDE_SESSIONSTART_TEMPLATE = `{"matcher":"^(startup|resume)$","hooks":[{"type":"command","command":"node \\"\${AUTO_GUARD_CLAUDE_SESSION_START}\\"","timeout":30}]}`

export const PROFILES: readonly HostProfile[] = [
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    detection: { dirs: ['.dsh'], files: [], executables: ['dsh'] },
    sessionNote: '生效需新开会话',
    action: {
      kind: 'command',
      executable: 'dsh',
      installArgs: ['plugin', 'add', '${AUTO_GUARD_DSH_DIR}'],
      removeArgs: ['plugin', 'remove', 'dsh-auto-guard'],
      listArgs: ['plugin', 'list'],
      pluginId: 'dsh-auto-guard',
    },
  },
  {
    id: 'pi',
    label: 'Pi Coding Agent',
    detection: { dirs: ['.pi'], files: [], executables: ['pi'] },
    sessionNote: '生效需新开会话',
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
    label: 'ZCode',
    detection: { dirs: ['.zcode'], files: ['.zcode/cli/config.json'], executables: [] },
    sessionNote: 'hooks 无热重载，必须新开 ZCode 会话',
    action: {
      kind: 'json-merge',
      file: '~/.zcode/cli/config.json',
      requiredTokens: ['${AUTO_GUARD_ZCODE_HOOK_CLI}', '${AUTO_GUARD_ZCODE_SESSION_START}'],
      ops: [
        { kind: 'array-append', arrayPath: ['hooks', 'PreToolUse'], template: ZCODE_PRETOOLUSE_TEMPLATE, markerSuffix: '/host-zcode/dist/hook-cli.js' },
        { kind: 'array-append', arrayPath: ['hooks', 'SessionStart'], template: ZCODE_SESSIONSTART_TEMPLATE, markerSuffix: '/host-zcode/dist/session-start.js' },
      ],
    },
  },
  {
    id: 'claude',
    label: 'Claude Code',
    detection: { dirs: ['.claude'], files: ['.claude/settings.json'], executables: ['claude'] },
    sessionNote: 'hooks 无热重载，必须新开 Claude Code 会话',
    postInstallNotes: [
      '验证：新会话运行 node <host-claude>/dist/cli.js guard ping，或执行一条命令观察审查提示',
      '⚠ 已知风险：cc-switch / clawd 等切换器会整体覆写 ~/.claude/settings.json 抹掉 hooks——若守卫失效，先检查该文件，再重跑 auto-guard init --host claude 恢复',
    ],
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
    label: 'OpenCode',
    detection: { dirs: ['.config/opencode'], files: ['.config/opencode/opencode.json'], executables: ['opencode'] },
    sessionNote: '插件随 opencode 启动加载，须新开 opencode 会话',
    postInstallNotes: [
      '说明：permission 中插入的 "*" 规则在 remove 时保留（无法区分归属）；如需清除请手工删除各工具对象首位的 "*": "ask"',
      '说明：你在 opencode 权限框选「本会话总是」后，同模式调用经宿主放行、不再进守卫（ADR-0011）',
    ],
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
