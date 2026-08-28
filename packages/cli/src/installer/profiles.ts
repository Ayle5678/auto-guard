/**
 * Host profiles: the installer's data layer (ADR-0008).
 *
 * Each supported host is one declarative profile — detection evidence, the
 * file to touch and the content templates — so adding a fourth host means
 * adding a profile (plus its @auto-guard/host-* adapter), never installer
 * logic. Templates are JSON strings with ${TOKEN} placeholders resolved
 * against the discovered @auto-guard/host-* package locations; the installer
 * only ever touches files a profile declares.
 */
import { isMessageKey, type MessageKey } from './i18n.ts'

export type HostId = 'dsh' | 'pi' | 'zcode'

export const HOST_IDS: readonly HostId[] = ['dsh', 'pi', 'zcode']

/** Resolved locations of the adapter packages the profiles integrate. */
export interface PackagePaths {
  pi: { srcIndex: string }
  zcode: { distHookCli: string; distSessionStart: string }
  dsh: { packageDir: string }
}

export interface DetectionSpec {
  /** HOME-relative directories suggesting the host, e.g. `.pi`. */
  dirs: string[]
  /** HOME-relative files — strongest evidence, e.g. `.zcode/cli/config.json`. */
  files: string[]
  /** Executables probed on PATH. */
  executables: string[]
}

export interface JsonMergeAction {
  kind: 'json-merge'
  /** HOME-relative target file, e.g. `~/.pi/agent/settings.json`. */
  file: string
  /** Elements appended to the array at `arrayPath` (created when missing). */
  ops: Array<{
    arrayPath: string[]
    /** JSON template with ${TOKEN} placeholders. */
    template: string
    /** Normalized (`/`-separated) suffix identifying "this entry is ours". */
    markerSuffix: string
  }>
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
  /** Init-summary note as an i18n key (hosts without hot reload say so here). */
  sessionNote: MessageKey
  action: JsonMergeAction | CommandAction
}

const ZCODE_PRETOOLUSE_TEMPLATE = `{"matcher":"^(Bash|Read|Write|Edit|ApplyPatch)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_HOOK_CLI}"],"timeoutMs":90000,"statusMessage":"🛡️ auto-guard 安全审查中…"}]}`
const ZCODE_SESSIONSTART_TEMPLATE = `{"matcher":"^(startup|resume)$","hooks":[{"type":"process","command":"node","args":["\${AUTO_GUARD_ZCODE_SESSION_START}"],"timeoutMs":10000,"statusMessage":"🛡️ auto-guard 会话初始化"}]}`

export const PROFILES: readonly HostProfile[] = [
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    detection: { dirs: ['.dsh'], files: [], executables: ['dsh'] },
    sessionNote: 'sessionNoteReload',
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
    sessionNote: 'sessionNoteReload',
    action: {
      kind: 'json-merge',
      file: '~/.pi/agent/settings.json',
      ops: [
        {
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
    sessionNote: 'sessionNoteHooksNoHotReload',
    action: {
      kind: 'json-merge',
      file: '~/.zcode/cli/config.json',
      requiredTokens: ['${AUTO_GUARD_ZCODE_HOOK_CLI}', '${AUTO_GUARD_ZCODE_SESSION_START}'],
      ops: [
        { arrayPath: ['hooks', 'PreToolUse'], template: ZCODE_PRETOOLUSE_TEMPLATE, markerSuffix: '/host-zcode/dist/hook-cli.js' },
        { arrayPath: ['hooks', 'SessionStart'], template: ZCODE_SESSIONSTART_TEMPLATE, markerSuffix: '/host-zcode/dist/session-start.js' },
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
  if (!HOST_IDS.includes(profile.id)) errors.push('id 必须是 dsh|pi|zcode 之一')
  if (!profile.label) errors.push('label 不能为空')
  const d = profile.detection
  if (!d || (!d.dirs?.length && !d.files?.length && !d.executables?.length)) errors.push('detection 需要至少一项证据（dirs/files/executables）')
  if (!profile.sessionNote) errors.push('sessionNote 不能为空')
  else if (!isMessageKey(profile.sessionNote)) errors.push(`sessionNote 必须是消息目录中的键：${profile.sessionNote}`)
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
