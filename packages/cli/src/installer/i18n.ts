/**
 * Installer bilingual message catalog (zh / en).
 *
 * One flat dictionary per language, keyed identically; `message()` interpolates
 * `{name}` placeholders. No i18n library — the installer surface is ~50 short
 * lines and stays review-able as data. Language resolution order lives in
 * install.ts: `--lang` flag > `AUTO_GUARD_LANG` env > interactive bilingual
 * prompt (init only) > `zh`. The `zh` fallback keeps piped/CI output and every
 * existing consumer byte-stable; scripts opt into English explicitly.
 */
export type Lang = 'zh' | 'en'

const ZH = {
  usage: '用法：auto-guard <init|list|remove> [--host dsh,pi,zcode] [--yes] [--home <path>] [--lang <zh|en>]',
  flagMissingValue: '{name} 缺少参数值',
  unknownFlag: '未知参数：{name}（可用：--host --yes --banner --home --lang）',
  unknownHosts: '未知宿主：{hosts}（可用值：{valid}）',
  hostNotDetected: '未检测到 {label}（{home} 下无宿主特征）：请先安装宿主，或在交互终端中运行 init 以手动确认',
  nonInteractiveHint: '当前环境非交互终端：请使用 --host <dsh|pi|zcode> 指定宿主并加 --yes，例如 auto-guard init --host pi,zcode --yes',
  nothingSelected: '未选择任何宿主，退出',
  alreadyIntegrated: '[{label}] 已接入，跳过（幂等：文件与备份未改动）',
  missingArtifacts: '[{label}] 缺少构建产物 {files}：请先在仓库运行 pnpm build',
  willDo: '[{label}] 将执行：',
  confirmNeedsNonInteractive: '[{label}] 需要确认但环境非交互：请加 --yes',
  confirmWrite: '确认写入 {label}？(y/N)：',
  declined: '[{label}] 已跳过（未确认）',
  hostDone: '[{label}] 完成',
  hostFailed: '[{label}] 失败（步骤 {step}）：{error}',
  installDone: '安装完成：',
  summaryEntry: '  · {label}（{note}）',
  verifyHint: '验证：新开会话后运行 auto-guard guard status，或在宿主中执行一条命令观察审查提示',
  configHint: '配置：各宿主独立 —— auto-guard set set-key --config-root ~/.<host>/auto-guard（也可 examine on 开审计）',
  uninstallHint: '卸载：auto-guard remove [--host dsh,pi,zcode]',
  seedingNote: '说明：守卫配置与数据在首次运行时播种到 ~/.<host>/auto-guard/，init 不创建这些文件',
  failuresSummary: '有 {count} 个宿主未完成：{hosts}',
  listDetectLine: '  检测: {value}',
  detectedYes: '是（{evidence}）',
  detectedNo: '否',
  listIntegratedLine: '  接入: {value}',
  integratedYes: '已接入',
  integratedNo: '未接入',
  integratedUnknown: '未知（无法读取宿主配置）',
  listNextLine: '  下一步: {value}',
  nextRunInit: 'auto-guard init --host {id} --yes',
  nextInstallFirst: '先安装 {label}，再运行 auto-guard init --host {id} --yes',
  listVerifyLine: '  验证: auto-guard guard status',
  listManualCheck: '  请手工检查宿主配置文件后再操作',
  removeOutcomeUntouched: '未改动',
  removeOutcomeDone: '已卸载',
  removeDataNote: '说明：守卫用户数据 ~/.<host>/auto-guard/ 保留；如需彻底清除请手动删除对应目录',
  selectHeader: '检测到以下宿主，选择要接入的（已检测到的默认勾选）：',
  selectHint: '回车确认默认勾选，或输入序号切换（如 1,3）：',
  evidenceSuffix: '（{evidence}）',
  notDetectedSuffix: '（未检测到）',
  selectionParseFailed: '无法解析输入，已取消',
  manualConfirmPrompt: '未检测到 {label}，写入目标：{target}。仍要接入？（误选可在此否决）(y/N)：',
  manualSkippedNote: '已跳过 {label}（未确认）',
  runCommandDesc: '运行 {command}',
  blockedNotJsonObject: '{file} 不是 JSON 对象，拒绝写入（请手工检查）',
  blockedUnparseableJson: '{file} 无法解析为 JSON，拒绝写入（请手工检查）',
  blockedNotArray: '{file} 中 {path} 不是数组，拒绝写入',
  templateRenderFailed: '模板渲染失败：{error}',
  planSkipped: '已接入，跳过',
  backupStepDesc: '备份 {file} → {backup}',
  writeStepDesc: '写入 {file}{suffix}',
  newFileSuffix: '（新建）',
  verifyMismatch: '写后校验不一致',
  nonzeroExit: '{exe} 退出码非 0',
  runnerUnavailable: '无法运行宿主命令（内部错误）',
  notIntegratedWithReason: '{label} 未接入（{reason}）',
  reasonExeOrPlugin: '{exe} 不可用或插件未注册',
  reasonFileMissing: '{file} 不存在',
  unregisteredOk: '已撤销 {plugin} 注册',
  uninstallCommandFailed: '卸载命令失败：{error}',
  restoredFromBackup: '已从备份还原 {file}',
  restoreBackupFailed: '还原备份失败：{error}',
  unparseableRefuseModify: '{file} 无法解析为 JSON，拒绝修改（请手工检查）',
  notIntegratedUntouched: '{label} 未接入，文件未改动',
  writeBackFailed: '写回失败：{error}',
  removedEntries: '已从 {file} 移除 {count} 个 auto-guard 条目',
  evidenceFound: '存在 ~/{path}',
  evidenceExe: '找到可执行文件 {exe}',
  sessionNoteReload: '生效需新开会话',
  sessionNoteHooksNoHotReload: 'hooks 无热重载，必须新开 ZCode 会话',
  bannerGuardName: '多宿主命令审查守卫',
} as const

export type MessageKey = keyof typeof ZH

const EN: Record<MessageKey, string> = {
  usage: 'Usage: auto-guard <init|list|remove> [--host dsh,pi,zcode] [--yes] [--home <path>] [--lang <zh|en>]',
  flagMissingValue: 'missing value for {name}',
  unknownFlag: 'Unknown flag: {name} (available: --host --yes --banner --home --lang)',
  unknownHosts: 'Unknown host(s): {hosts} (valid values: {valid})',
  hostNotDetected: 'Host not detected: {label} (no host markers under {home}). Install the host first, or run init in an interactive terminal to confirm manually',
  nonInteractiveHint: 'This is not an interactive terminal: pass --host <dsh|pi|zcode> plus --yes, e.g. auto-guard init --host pi,zcode --yes',
  nothingSelected: 'No host selected, exiting',
  alreadyIntegrated: '[{label}] already integrated, skipping (idempotent: files and backups untouched)',
  missingArtifacts: '[{label}] missing build artifact(s) {files}: run pnpm build in the repo first',
  willDo: '[{label}] will:',
  confirmNeedsNonInteractive: '[{label}] needs confirmation but the environment is non-interactive: add --yes',
  confirmWrite: 'Write to {label}? (y/N): ',
  declined: '[{label}] skipped (not confirmed)',
  hostDone: '[{label}] done',
  hostFailed: '[{label}] failed (step {step}): {error}',
  installDone: 'Installation complete:',
  summaryEntry: '  · {label} ({note})',
  verifyHint: 'Verify: start a new session and run auto-guard guard status, or run any command in the host and watch for the review prompt',
  configHint: 'Configure: one root per host — auto-guard set set-key --config-root ~/.<host>/auto-guard (or run examine on to enable the audit log)',
  uninstallHint: 'Uninstall: auto-guard remove [--host dsh,pi,zcode]',
  seedingNote: 'Note: guard config and data are seeded into ~/.<host>/auto-guard/ on first run; init does not create them',
  failuresSummary: '{count} host(s) not finished: {hosts}',
  listDetectLine: '  Detected: {value}',
  detectedYes: 'yes ({evidence})',
  detectedNo: 'no',
  listIntegratedLine: '  Integrated: {value}',
  integratedYes: 'integrated',
  integratedNo: 'not integrated',
  integratedUnknown: 'unknown (cannot read the host config)',
  listNextLine: '  Next: {value}',
  nextRunInit: 'auto-guard init --host {id} --yes',
  nextInstallFirst: 'Install {label} first, then run auto-guard init --host {id} --yes',
  listVerifyLine: '  Verify: auto-guard guard status',
  listManualCheck: '  Inspect the host config file manually before acting',
  removeOutcomeUntouched: 'unchanged',
  removeOutcomeDone: 'uninstalled',
  removeDataNote: 'Note: guard user data under ~/.<host>/auto-guard/ is kept; delete the directory manually to wipe it completely',
  selectHeader: 'Detected hosts below — pick the ones to integrate (detected ones are pre-checked):',
  selectHint: 'Press Enter to accept the defaults, or type numbers to toggle (e.g. 1,3): ',
  evidenceSuffix: ' ({evidence})',
  notDetectedSuffix: ' (not detected)',
  selectionParseFailed: 'Could not parse the input, cancelled',
  manualConfirmPrompt: '{label} was not detected. Write target: {target}. Integrate anyway? (this is where you veto a false positive) (y/N): ',
  manualSkippedNote: 'Skipped {label} (not confirmed)',
  runCommandDesc: 'Run {command}',
  blockedNotJsonObject: '{file} is not a JSON object; refusing to write (inspect it manually)',
  blockedUnparseableJson: '{file} does not parse as JSON; refusing to write (inspect it manually)',
  blockedNotArray: '{path} in {file} is not an array; refusing to write',
  templateRenderFailed: 'Template render failed: {error}',
  planSkipped: 'already integrated, skipping',
  backupStepDesc: 'Back up {file} → {backup}',
  writeStepDesc: 'Write {file}{suffix}',
  newFileSuffix: ' (new file)',
  verifyMismatch: 'post-write verification mismatch',
  nonzeroExit: '{exe} exited non-zero',
  runnerUnavailable: 'Cannot run the host command (internal error)',
  notIntegratedWithReason: '{label} is not integrated ({reason})',
  reasonExeOrPlugin: '{exe} unavailable or plugin not registered',
  reasonFileMissing: '{file} does not exist',
  unregisteredOk: 'Unregistered {plugin}',
  uninstallCommandFailed: 'Uninstall command failed: {error}',
  restoredFromBackup: 'Restored {file} from backup',
  restoreBackupFailed: 'Failed to restore the backup: {error}',
  unparseableRefuseModify: '{file} does not parse as JSON; refusing to modify (inspect it manually)',
  notIntegratedUntouched: '{label} is not integrated; the file was left untouched',
  writeBackFailed: 'Failed to write back: {error}',
  removedEntries: 'Removed {count} auto-guard entry(ies) from {file}',
  evidenceFound: 'found ~/{path}',
  evidenceExe: 'found executable {exe}',
  sessionNoteReload: 'takes effect in a new session',
  sessionNoteHooksNoHotReload: 'hooks have no hot reload — you must start a new ZCode session',
  bannerGuardName: 'multi-host command review guard',
}

/** Interpolate one message; unknown placeholders pass through untouched. */
export function message(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  const template = (lang === 'en' ? EN : ZH)[key]
  return template.replace(/\{(\w+)\}/g, (raw, name: string) => (name in params ? String(params[name]) : raw))
}

export function isMessageKey(value: string): value is MessageKey {
  return value in ZH
}

/** Accept `zh` / `zh-CN` / `en` / `en-US` (case-insensitive); anything else is invalid. */
export function normalizeLang(value: string | undefined): Lang | undefined {
  const v = value?.trim().toLowerCase()
  if (!v) return undefined
  if (v.startsWith('zh')) return 'zh'
  if (v.startsWith('en')) return 'en'
  return undefined
}

/** `AUTO_GUARD_LANG` env override, shared with the management CLI commands. */
export function envLang(): Lang | undefined {
  return normalizeLang(process.env.AUTO_GUARD_LANG)
}

/** Emitted before any language is known, so it is fixed bilingual. */
export function invalidLangMessage(value: string): string {
  return `无效 --lang 值 / invalid --lang value: ${value}（可用 / available: zh, en）`
}
