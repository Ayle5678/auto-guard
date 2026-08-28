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
import { message, type Lang, type MessageKey } from './i18n.ts'
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
  /** Output language for outcome messages (default zh). */
  lang?: Lang
}

const BACKUP_SUFFIX = '.auto-guard.bak'

export function removeHost(profile: HostProfile, options: RemoveOptions): RemoveOutcome {
  const fileExists = options.fileExists ?? existsSync
  const lang = options.lang ?? 'zh'
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const action = profile.action
  if (action.kind === 'command') {
    const runner = options.runCommand
    if (!runner) return { status: 'failed', message: t('runnerUnavailable') }
    // Confirm registration before uninstalling: an uninstalled dsh CLI or an
    // unregistered plugin is "not integrated", never a failure.
    const list = runner(action.executable, action.listArgs)
    const registered = list.ok && (list.stdout ?? '').includes(action.pluginId)
    if (!registered) {
      return { status: 'not-integrated', message: t('notIntegratedWithReason', { label: profile.label, reason: t('reasonExeOrPlugin', { exe: action.executable }) }) }
    }
    const result = runner(action.executable, action.removeArgs)
    if (result.ok) return { status: 'removed', message: t('unregisteredOk', { plugin: action.pluginId }) }
    return { status: 'failed', message: t('uninstallCommandFailed', { error: result.stderr || t('nonzeroExit', { exe: action.executable }) }) }
  }

  const targetFile = homePath(options.home, action.file)
  const backupFile = `${targetFile}${BACKUP_SUFFIX}`
  if (fileExists(backupFile)) {
    try {
      copyFileSync(backupFile, targetFile)
      rmSync(backupFile)
      return { status: 'restored', message: t('restoredFromBackup', { file: action.file }), files: [targetFile] }
    } catch (error) {
      return { status: 'failed', message: t('restoreBackupFailed', { error: error instanceof Error ? error.message : String(error) }) }
    }
  }
  const read = readJsonObject(targetFile, fileExists)
  if (!read.ok) {
    return read.missing
      ? { status: 'not-integrated', message: t('notIntegratedWithReason', { label: profile.label, reason: t('reasonFileMissing', { file: action.file }) }) }
      : { status: 'unknown', message: t('unparseableRefuseModify', { file: action.file }) }
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
    return { status: 'not-integrated', message: t('notIntegratedUntouched', { label: profile.label }) }
  }
  try {
    writeFileSync(targetFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch (error) {
    return { status: 'failed', message: t('writeBackFailed', { error: error instanceof Error ? error.message : String(error) }) }
  }
  return { status: 'removed', message: t('removedEntries', { file: action.file, count: removed }), files: [targetFile] }
}
