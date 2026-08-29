/**
 * Write-plan construction and application (ticket 02, idempotency from
 * ticket 03). Planning is pure: given the current file contents it produces
 * the exact steps (backup → write → verify, or one native command) the
 * installer will show to the user before touching anything. Applying never
 * overwrites an existing backup, so repeated inits converge (ADR-0008).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { arrayAt, defaultRunCommand, hasMarker, homePath, objectAt, type RunCommand } from './integration.ts'
import { message, type Lang, type MessageKey } from './i18n.ts'
import { renderTemplate, type HostProfile, type PackagePaths } from './profiles.ts'

export interface PlanStep {  kind: 'backup' | 'write' | 'run-command'
  /** Human-readable line for the diff/summary view. */
  description: string
  targetFile?: string
  backupFile?: string
  /** Full next content for `write` steps. */
  content?: string
  command?: { executable: string; args: string[] }
}

export interface HostPlan {
  profileId: string
  label: string
  /** Set when nothing needs doing (already integrated) or the plan is blocked. */
  skipped?: string
  blocked?: string
  steps: PlanStep[]
  /** `+ <entry>` lines describing exactly what would be added. */
  diff: string[]
  targetFiles: string[]
}

export interface PlanOptions {
  home: string
  paths: PackagePaths
  /** Content snapshot: return the file text or null when absent (tests inject this). */
  readFile?: (p: string) => string | null
  /** Output language for step descriptions and blocked reasons (default zh). */
  lang?: Lang
}

function defaultReadFile(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

export function buildInitPlan(profile: HostProfile, options: PlanOptions): HostPlan {
  const lang = options.lang ?? 'zh'
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => message(lang, key, params)
  const plan: HostPlan = { profileId: profile.id, label: profile.label, steps: [], diff: [], targetFiles: [] }
  const action = profile.action
  if (action.kind !== 'json-merge') {
    const args = renderTemplate(action.installArgs.join(' '), options.paths)
    plan.steps.push({
      kind: 'run-command',
      description: t('runCommandDesc', { command: `${action.executable} ${args}` }),
      command: { executable: action.executable, args: action.installArgs.map((arg) => renderTemplate(arg, options.paths)) },
    })
    return plan
  }

  const readFile = options.readFile ?? defaultReadFile
  const targetFile = homePath(options.home, action.file)
  plan.targetFiles.push(targetFile)

  // Pure over the injected snapshot: `null` = file absent.
  const raw = readFile(targetFile)
  let doc: Record<string, unknown> = {}
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        plan.blocked = t('blockedNotJsonObject', { file: action.file })
        return plan
      }
      doc = parsed as Record<string, unknown>
    } catch {
      plan.blocked = t('blockedUnparseableJson', { file: action.file })
      return plan
    }
  }

  let changed = false
  for (const op of action.ops) {
    const arr = arrayAt(doc, op.arrayPath, true)
    if (!arr) {
      plan.blocked = t('blockedNotArray', { file: action.file, path: op.arrayPath.join('.') })
      return plan
    }
    if (arr.some((el) => hasMarker(el, op.markerSuffix))) continue
    let element: unknown
    try {
      element = JSON.parse(renderTemplate(op.template, options.paths))
    } catch (error) {
      plan.blocked = t('templateRenderFailed', { error: error instanceof Error ? error.message : String(error) })
      return plan
    }
    arr.push(element)
    plan.diff.push(`+ ${JSON.stringify(element)}`)
    changed = true
  }
  for (const item of action.ensure ?? []) {
    const parent = objectAt(doc, item.path, true)
    if (!parent) {
      plan.blocked = t('blockedNotObject', { file: action.file, path: item.path.join('.') })
      return plan
    }
    const key = item.path[item.path.length - 1]!
    if (parent[key] === item.value) continue
    parent[key] = item.value
    plan.diff.push(`+ ${item.path.join('.')} = ${JSON.stringify(item.value)}`)
    changed = true
  }
  for (const item of action.legacyCleanup ?? []) {
    const parent = objectAt(doc, item.path, false)
    const key = item.path[item.path.length - 1]!
    const arr = parent?.[key]
    if (!parent || !Array.isArray(arr)) continue
    const kept = arr.filter((el) => !hasMarker(el, item.markerSuffix))
    if (kept.length === arr.length) continue
    plan.diff.push(`- ${t('legacyCleanupDesc', { path: item.path.join('.'), count: arr.length - kept.length })}`)
    changed = true
    if (kept.length) parent[key] = kept
    else delete parent[key]
  }
  if (!changed) {
    plan.skipped = t('planSkipped')
    return plan
  }

  if (raw !== null) {
    const backupFile = `${targetFile}.auto-guard.bak`
    plan.steps.push({ kind: 'backup', description: t('backupStepDesc', { file: action.file, backup: backupFile }), targetFile, backupFile })
  }
  plan.steps.push({
    kind: 'write',
    description: t('writeStepDesc', { file: action.file, suffix: raw !== null ? '' : t('newFileSuffix') }),
    targetFile,
    content: `${JSON.stringify(doc, null, 2)}\n`,
  })
  return plan
}

export interface ApplyOutcome {
  ok: boolean
  /** Which step failed: backup | write | verify | run-command. */
  failedStep?: string
  error?: string
}

export interface ApplyOptions {
  fileExists?: (p: string) => boolean
  runCommand?: RunCommand
  /** Output language for failure errors it produces itself (default zh). */
  lang?: Lang
}

/** Execute one host's plan sequentially; on failure stop and name the step. */
export function applyHostPlan(plan: HostPlan, options: ApplyOptions = {}): ApplyOutcome {
  const fileExists = options.fileExists ?? existsSync
  const lang = options.lang ?? 'zh'
  for (const step of plan.steps) {
    try {
      if (step.kind === 'backup') {
        if (fileExists(step.backupFile!) || !fileExists(step.targetFile!)) continue
        copyFileSync(step.targetFile!, step.backupFile!)
      } else if (step.kind === 'write') {
        mkdirSync(dirname(step.targetFile!), { recursive: true })
        writeFileSync(step.targetFile!, step.content!, 'utf8')
        if (readFileSync(step.targetFile!, 'utf8') !== step.content) {
          return { ok: false, failedStep: 'verify', error: message(lang, 'verifyMismatch') }
        }
      } else if (step.kind === 'run-command') {
        const runner = options.runCommand ?? defaultRunCommand
        const result = runner(step.command!.executable, step.command!.args)
        if (!result.ok) {
          return { ok: false, failedStep: 'run-command', error: result.stderr || message(lang, 'nonzeroExit', { exe: step.command!.executable }) }
        }
      }
    } catch (error) {
      return { ok: false, failedStep: step.kind, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true }
}
