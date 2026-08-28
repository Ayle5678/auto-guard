/**
 * Write-plan construction and application (ticket 02, idempotency from
 * ticket 03). Planning is pure: given the current file contents it produces
 * the exact steps (backup → write → verify, or one native command) the
 * installer will show to the user before touching anything. Applying never
 * overwrites an existing backup, so repeated inits converge (ADR-0008).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { arrayAt, defaultRunCommand, hasMarker, homePath, type RunCommand } from './integration.ts'
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
}

function defaultReadFile(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

export function buildInitPlan(profile: HostProfile, options: PlanOptions): HostPlan {
  const plan: HostPlan = { profileId: profile.id, label: profile.label, steps: [], diff: [], targetFiles: [] }
  const action = profile.action
  if (action.kind !== 'json-merge') {
    plan.steps.push({
      kind: 'run-command',
      description: `运行 ${action.executable} ${renderTemplate(action.installArgs.join(' '), options.paths)}`,
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
        plan.blocked = `${action.file} 不是 JSON 对象，拒绝写入（请手工检查）`
        return plan
      }
      doc = parsed as Record<string, unknown>
    } catch {
      plan.blocked = `${action.file} 无法解析为 JSON，拒绝写入（请手工检查）`
      return plan
    }
  }

  let changed = false
  for (const op of action.ops) {
    if (op.kind === 'permission-ask-rules') {
      // ADR-0011: "*" must land FIRST in each tool object (last matching
      // rule wins, user rules after it keep priority). A non-object value
      // (global "allow"/"deny" string) is the user's own choice — never
      // overwritten, surfaced as a note instead.
      const permission = (doc.permission ?? {}) as Record<string, unknown>
      if (typeof permission !== 'object' || Array.isArray(permission)) {
        plan.blocked = `${action.file} 中 permission 不是对象，拒绝写入`
        return plan
      }
      let permissionTouched = false
      for (const tool of op.tools) {
        const current = permission[tool]
        if (current === undefined) {
          permission[tool] = { '*': op.action }
          plan.diff.push(`+ permission.${tool} = {"*": "${op.action}"}`)
          changed = true
          permissionTouched = true
        } else if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
          const rules = current as Record<string, unknown>
          if (rules['*'] !== undefined) continue // idempotent no-op
          permission[tool] = { '*': op.action, ...rules }
          plan.diff.push(`+ permission.${tool}.* = "${op.action}"（插入首位，既有规则保持优先）`)
          changed = true
          permissionTouched = true
        } else {
          plan.diff.push(`~ permission.${tool} 已是全局动作 ${JSON.stringify(current)}，跳过（该工具不经守卫）`)
        }
      }
      if (permissionTouched) doc.permission = permission
      continue
    }
    const arr = arrayAt(doc, op.arrayPath, true)
    if (!arr) {
      plan.blocked = `${action.file} 中 ${op.arrayPath.join('.')} 不是数组，拒绝写入`
      return plan
    }
    if (arr.some((el) => hasMarker(el, op.markerSuffix))) continue
    let element: unknown
    try {
      element = JSON.parse(renderTemplate(op.template, options.paths))
    } catch (error) {
      plan.blocked = `模板渲染失败：${error instanceof Error ? error.message : String(error)}`
      return plan
    }
    arr.push(element)
    plan.diff.push(`+ ${JSON.stringify(element)}`)
    changed = true
  }
  if (!changed) {
    plan.skipped = '已接入，跳过'
    return plan
  }

  if (raw !== null) {
    const backupFile = `${targetFile}.auto-guard.bak`
    plan.steps.push({ kind: 'backup', description: `备份 ${action.file} → ${backupFile}`, targetFile, backupFile })
  }
  plan.steps.push({
    kind: 'write',
    description: `写入 ${action.file}${raw !== null ? '' : '（新建）'}`,
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
}

/** Execute one host's plan sequentially; on failure stop and name the step. */
export function applyHostPlan(plan: HostPlan, options: ApplyOptions = {}): ApplyOutcome {
  const fileExists = options.fileExists ?? existsSync
  for (const step of plan.steps) {
    try {
      if (step.kind === 'backup') {
        if (fileExists(step.backupFile!) || !fileExists(step.targetFile!)) continue
        copyFileSync(step.targetFile!, step.backupFile!)
      } else if (step.kind === 'write') {
        mkdirSync(dirname(step.targetFile!), { recursive: true })
        writeFileSync(step.targetFile!, step.content!, 'utf8')
        if (readFileSync(step.targetFile!, 'utf8') !== step.content) {
          return { ok: false, failedStep: 'verify', error: '写后校验不一致' }
        }
      } else if (step.kind === 'run-command') {
        const runner = options.runCommand ?? defaultRunCommand
        const result = runner(step.command!.executable, step.command!.args)
        if (!result.ok) {
          return { ok: false, failedStep: 'run-command', error: result.stderr || `${step.command!.executable} 退出码非 0` }
        }
      }
    } catch (error) {
      return { ok: false, failedStep: step.kind, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true }
}
