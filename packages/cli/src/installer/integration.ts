/**
 * Integration status checks (ticket 01) and the JSON merge primitives shared
 * by plan/remove (tickets 02/04). "Integrated" means: every op declared by
 * the profile finds its marker element in the target document. Markers are
 * normalized (`\` → `/`, lowercased) suffix matches, so the same suffix works
 * across platforms regardless of the separator used at write time.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROFILES, type CommandAction, type JsonMergeAction, type PackagePaths } from './profiles.ts'

export type IntegrationStatus = 'integrated' | 'not-integrated' | 'unknown'

/** Expand a HOME-relative profile path (`~/x/y`) to an absolute path. */
export function homePath(home: string, profilePath: string): string {
  return join(home, profilePath.replace(/^~[/\\]/, ''))
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase()
}

/** True for a plain JSON object (not null, not an array) — the only shape merge ops write into. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when a raw array element (string or object) carries our marker. */
export function hasMarker(element: unknown, markerSuffix: string): boolean {
  const raw = typeof element === 'string' ? element : JSON.stringify(element ?? '')
  return normalizePath(raw).includes(normalizePath(markerSuffix))
}

type ReadResult = { ok: true; doc: Record<string, unknown> } | { ok: false; missing: boolean }

/** Read + parse a JSON object file; missing files and non-object documents are distinguished. */
export function readJsonObject(targetFile: string, fileExists: (p: string) => boolean): ReadResult {
  if (!fileExists(targetFile)) return { ok: false, missing: true }
  try {
    const doc = JSON.parse(readFileSync(targetFile, 'utf8'))
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, missing: false }
    return { ok: true, doc: doc as Record<string, unknown> }
  } catch {
    return { ok: false, missing: false }
  }
}

/** Read the array at `arrayPath`; when `create`, missing parents/arrays are created in place. */
export function arrayAt(doc: Record<string, unknown>, arrayPath: string[], create: boolean): unknown[] | undefined {
  let node: Record<string, unknown> = doc
  for (const key of arrayPath.slice(0, -1)) {
    const next = node[key]
    if (next === undefined) {
      if (!create) return undefined
      node[key] = {}
    } else if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return undefined
    }
    node = node[key] as Record<string, unknown>
  }
  const last = arrayPath[arrayPath.length - 1]!
  const arr = node[last]
  if (arr === undefined) {
    if (!create) return undefined
    node[last] = []
  } else if (!Array.isArray(arr)) {
    return undefined
  }
  return node[last] as unknown[]
}

export function jsonMergeStatus(targetFile: string, action: JsonMergeAction, fileExists: (p: string) => boolean): IntegrationStatus {
  const read = readJsonObject(targetFile, fileExists)
  if (!read.ok) return read.missing ? 'not-integrated' : 'unknown'
  for (const op of action.ops) {
    if (op.kind === 'permission-ask-rules') {
      const permission = read.doc.permission
      if (!isPlainObject(permission)) return 'not-integrated'
      for (const tool of op.tools) {
        const rules = permission[tool]
        if (!isPlainObject(rules) || rules['*'] === undefined) return 'not-integrated'
      }
      continue
    }
    const arr = arrayAt(read.doc, op.arrayPath, false)
    if (!arr || !arr.some((el) => hasMarker(el, op.markerSuffix))) return 'not-integrated'
  }
  return 'integrated'
}

export interface CommandResult {
  ok: boolean
  stdout?: string
  stderr?: string
}

export function commandStatus(action: CommandAction, runCommand: (exe: string, args: string[]) => CommandResult): IntegrationStatus {
  const result = runCommand(action.executable, action.listArgs)
  if (!result.ok || result.stdout === undefined) return 'unknown'
  return result.stdout.includes(action.pluginId) ? 'integrated' : 'not-integrated'
}

export type RunCommand = (exe: string, args: string[]) => CommandResult

/** Dispatch integration status for a profile id against one HOME. */
export function integrationStatus(profileId: string, options: { home: string; paths: PackagePaths; fileExists?: (p: string) => boolean; runCommand?: RunCommand }): IntegrationStatus {
  const profile = PROFILES.find((p) => p.id === profileId)
  if (!profile) return 'unknown'
  const fileExists = options.fileExists ?? existsSync
  const runCommand = options.runCommand ?? defaultRunCommand
  if (profile.action.kind === 'json-merge') {
    return jsonMergeStatus(homePath(options.home, profile.action.file), profile.action, fileExists)
  }
  return commandStatus(profile.action, runCommand)
}

/** Minimal spawn-based runner (win32 shells out to resolve `.cmd` shims). */
export function defaultRunCommand(executable: string, args: string[]): CommandResult {
  if (process.platform === 'win32') {
    // Windows `.cmd` shims need a shell; pass ONE quoted command string to
    // avoid the args+shell unescaped-concatenation trap (DEP0190).
    const quoted = [executable, ...args].map((part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part)).join(' ')
    const result = spawnSync(quoted, { encoding: 'utf8', shell: true })
    if (result.error) return { ok: false, stderr: String(result.error) }
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  const result = spawnSync(executable, args, { encoding: 'utf8' })
  if (result.error) return { ok: false, stderr: String(result.error) }
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}
