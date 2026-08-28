/**
 * `auto-guard remove` (ticket 04): the inverse of init, per profile.
 *
 * Two removal paths: when an installer-created backup (`*.auto-guard.bak`)
 * exists it is restored byte-for-byte (and the backup consumed); otherwise
 * the profile's marker entries are removed structurally (e.g. installed by
 * hand earlier). Guard data roots (`~/.<host>/auto-guard/`) are never touched
 * — user data survives uninstall by design (spec 0002).
 */
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arrayAt, hasMarker, homePath, readJsonObject, type RunCommand } from './integration.ts'
import type { HostProfile } from './profiles.ts'

export type RemoveStatus = 'restored' | 'removed' | 'not-integrated' | 'unknown' | 'failed'

export interface RemoveOutcome {
  status: RemoveStatus
  message?: string
  files?: string[]
}

export interface RemoveOptions {
  home: string
  fileExists?: (p: string) => boolean
  runCommand?: RunCommand
}

const BACKUP_SUFFIX = '.auto-guard.bak'

export function removeHost(profile: HostProfile, options: RemoveOptions): RemoveOutcome {
  const fileExists = options.fileExists ?? existsSync
  const action = profile.action
  if (action.kind === 'command') {
    const runner = options.runCommand
    if (!runner) return { status: 'failed', message: '无法运行宿主命令（内部错误）' }
    // Confirm registration before uninstalling: an uninstalled dsh CLI or an
    // unregistered plugin is "未接入", never a failure.
    const list = runner(action.executable, action.listArgs)
    const registered = list.ok && (list.stdout ?? '').includes(action.pluginId)
    if (!registered) return { status: 'not-integrated', message: `${profile.label} 未接入（${action.executable} 不可用或插件未注册）` }
    const result = runner(action.executable, action.removeArgs)
    if (result.ok) return { status: 'removed', message: `已撤销 ${action.pluginId} 注册` }
    return { status: 'failed', message: `卸载命令失败：${result.stderr || '退出码非 0'}` }
  }

  const targetFile = homePath(options.home, action.file)
  const backupFile = `${targetFile}${BACKUP_SUFFIX}`
  if (fileExists(backupFile)) {
    try {
      copyFileSync(backupFile, targetFile)
      rmSync(backupFile)
      return { status: 'restored', message: `已从备份还原 ${action.file}`, files: [targetFile] }
    } catch (error) {
      return { status: 'failed', message: `还原备份失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const read = readJsonObject(targetFile, fileExists)
  if (!read.ok) {
    return read.missing
      ? { status: 'not-integrated', message: `${profile.label} 未接入（${action.file} 不存在）` }
      : { status: 'unknown', message: `${action.file} 无法解析为 JSON，拒绝修改（请手工检查）` }
  }
  const record = read.doc
  let removed = 0
  for (const op of action.ops) {
    const arr = arrayAt(record, op.arrayPath, false)
    if (!arr) continue
    const kept = arr.filter((el) => !hasMarker(el, op.markerSuffix))
    removed += arr.length - kept.length
    if (kept.length !== arr.length) arr.splice(0, arr.length, ...kept)
  }
  if (removed === 0) {
    return { status: 'not-integrated', message: `${profile.label} 未接入，文件未改动` }
  }
  try {
    writeFileSync(targetFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch (error) {
    return { status: 'failed', message: `写回失败：${error instanceof Error ? error.message : String(error)}` }
  }
  return { status: 'removed', message: `已从 ${action.file} 移除 ${removed} 个 auto-guard 条目`, files: [targetFile] }
}
