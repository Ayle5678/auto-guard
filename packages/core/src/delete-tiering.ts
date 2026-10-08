/**
 * Directory-delete tiering (ADR-0027 / SPEC 0028): the pure stat-signal
 * classifier that grades a deletion's targets light / standard / strict
 * before the review flow picks a disposition. Strict signals judge first,
 * multi-target takes the strictest, stat failures fall back conservative
 * (standard). Zero LLM, zero network — node:fs only (ADR-0002). The
 * disposition wiring (reason protocol, single review, strict allow-cap)
 * lives in GuardService.decideDirectoryDelete.
 *
 * All fs paths flow through `normalizePath`, so hosts and tests address the
 * tree with forward slashes on every platform.
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { expandHome, normalizePath } from './command.ts'
import { matchPattern } from './rules.ts'
import { isSensitivePath } from './sensitive-path.ts'
import type { DirectoryDeletePolicy } from './types.ts'

export type DeleteTier = 'light' | 'standard' | 'strict'

export interface DeleteTierResult {
  tier: DeleteTier
  /**
   * True when every target stat-ed to a plain file with no failure — the
   * wiring then skips the reason protocol entirely and falls back to the
   * normal pipeline (grill 2026-10-05 Round 2 Q9); the sensitive-path gate
   * still intercepts sensitive files upstream of it.
   */
  allPlainFiles: boolean
}

export interface DeleteTierInput {
  /** Raw deletion-target tokens (relative tokens resolve against the workspace). */
  targets: readonly string[]
  workspace?: string
  sensitivePaths: readonly string[]
  /** Unvalidated `directoryDeletePolicy` rules field — missing/partial falls back all-standard (ADR-0013 conservatism). */
  policy: unknown
  /** Overrides the home directory used for root-proximity (defaults to os.homedir). */
  home?: string
  /** Injectable fs surface; defaults to the real one. */
  fs?: TierFs
}

/** The stat shape the tiering needs; `undefined` means the target could not be stat-ed. */
export interface TierStat {
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface TierDirent {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

/** The only fs surface tiering touches (ADR-0002: node built-ins). */
export interface TierFs {
  stat(path: string): Promise<TierStat | undefined>
  entries(dir: string): Promise<TierDirent[] | undefined>
}

const realFs: TierFs = {
  async stat(path) {
    try {
      const info = await stat(path)
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size }
    } catch {
      return undefined
    }
  },
  async entries(dir) {
    try {
      const dirents = await readdir(dir, { withFileTypes: true })
      return dirents.map((dirent) => ({
        name: dirent.name,
        isFile: dirent.isFile(),
        isDirectory: dirent.isDirectory(),
        isSymlink: dirent.isSymbolicLink(),
      }))
    } catch {
      return undefined
    }
  },
}

/** Strict-positive shape check for the policy data field; anything else means "no tiering, all standard". */
function asValidPolicy(value: unknown): DirectoryDeletePolicy | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  for (const key of ['strictMaxDepth', 'largeMinFiles', 'largeMinBytes', 'trivialMaxFiles', 'trivialMaxBytes'] as const) {
    const raw = candidate[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined
  }
  for (const key of ['regenerableNames', 'tempRoots'] as const) {
    const list = candidate[key]
    if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) return undefined
  }
  return value as DirectoryDeletePolicy
}

/** Windows compares paths case-insensitively; POSIX does not. */
function foldIfWindows(text: string): string {
  return process.platform === 'win32' ? text.toLowerCase() : text
}

/** Filesystem root of a normalized path: drive root (`D:/`), UNC share (`//server/share/`) or POSIX `/`. */
function fsRootOf(path: string): string {
  if (/^[a-zA-Z]:\//.test(path)) return path.slice(0, 3)
  if (path.startsWith('//')) {
    const share = path.indexOf('/', path.indexOf('/', 2) + 1)
    return share >= 0 ? path.slice(0, share + 1) : path
  }
  return '/'
}

/**
 * Segments of `path` strictly below `root`, or undefined when `path` is not
 * under `root` (a path equal to its root has depth 0).
 */
function depthUnder(root: string, path: string): number | undefined {
  const strippedRoot = root.replace(/\/+$/, '')
  const strippedPath = path.replace(/\/+$/, '')
  if (strippedRoot === '') return strippedPath.split('/').filter(Boolean).length
  if (!strippedPath.startsWith(`${strippedRoot}/`)) return undefined
  return strippedPath.slice(strippedRoot.length + 1).split('/').filter(Boolean).length
}

/** True when the target sits at or within `strictMaxDepth` levels of the drive root or the home directory. */
function isRootProximate(normalizedPath: string, home: string, strictMaxDepth: number): boolean {
  const folded = foldIfWindows(normalizedPath)
  const depths: number[] = [depthUnder(foldIfWindows(fsRootOf(folded)), folded)].filter(
    (depth): depth is number => depth !== undefined,
  )
  const homeDepth = depthUnder(foldIfWindows(home), folded)
  if (homeDepth !== undefined) depths.push(homeDepth)
  return depths.some((depth) => depth <= strictMaxDepth)
}

/** Strictly under the root (depth ≥ 1): the root itself is never "inside" its own subtree. */
function isLocatedUnder(root: string | undefined, path: string): boolean {
  if (!root) return false
  const depth = depthUnder(foldIfWindows(root), foldIfWindows(path))
  return depth !== undefined && depth >= 1
}

interface SizeScan {
  files: number
  bytes: number
  /** True when a large threshold was reached — "large" by definition, the walk stopped there. */
  capped: boolean
}

/** Capped file/byte walk: stops the moment a large threshold is reached, so node_modules-scale trees are never fully counted. */
async function scanDirectory(fs: TierFs, root: string, policy: DirectoryDeletePolicy): Promise<SizeScan> {
  let files = 0
  let bytes = 0
  const queue = [root]
  while (queue.length > 0) {
    const dir = queue.shift()!
    const entries = await fs.entries(dir)
    if (!entries) continue
    for (const entry of entries) {
      if (entry.isSymlink) continue
      const child = normalizePath(resolve(dir, entry.name))
      if (entry.isDirectory) {
        queue.push(child)
        continue
      }
      if (!entry.isFile) continue
      files++
      const info = await fs.stat(child)
      bytes += info?.size ?? 0
      if (files >= policy.largeMinFiles || bytes >= policy.largeMinBytes) return { files, bytes, capped: true }
    }
  }
  return { files, bytes, capped: false }
}

/**
 * Grade one deletion's targets (ADR-0027): strict on any sensitive /
 * root-proximate / over-large target; light only when every target sits in
 * the workspace or a temp root and is regenerable-named or trivially small;
 * everything else standard. Stat failures and a missing/partial policy
 * conservatively produce standard.
 */
export async function tierForDeletionTargets(input: DeleteTierInput): Promise<DeleteTierResult> {
  const fs = input.fs ?? realFs
  const policy = asValidPolicy(input.policy)
  const targets = [...new Set(input.targets.map((target) => target.trim()).filter(Boolean))]
  if (!policy || targets.length === 0) return { tier: 'standard', allPlainFiles: false }

  const home = normalizePath(input.home ?? homedir())
  const workspaceRoot = input.workspace ? normalizePath(input.workspace) : undefined
  const tempRoots = (policy.tempRoots.length > 0 ? policy.tempRoots : [tmpdir()]).map((root) => normalizePath(root))

  let allPlainFiles = true
  let strict = false
  let lightCapable = true

  for (const target of targets) {
    const absolute = normalizePath(resolve(input.workspace ?? process.cwd(), expandHome(target)))
    const info = await fs.stat(absolute)
    if (!info || (!info.isFile && !info.isDirectory)) {
      allPlainFiles = false
      lightCapable = false
      continue
    }
    if (info.isDirectory) allPlainFiles = false
    if (strict) continue

    if (isSensitivePath(absolute, input.sensitivePaths) || isRootProximate(absolute, home, policy.strictMaxDepth)) {
      strict = true
      continue
    }

    const regenerable = policy.regenerableNames.some((pattern) => matchPattern(basename(absolute), pattern))
    if (!regenerable) {
      if (info.isDirectory) {
        const scan = await scanDirectory(fs, absolute, policy)
        if (scan.capped) {
          strict = true
          continue
        }
        if (scan.files > policy.trivialMaxFiles || scan.bytes > policy.trivialMaxBytes) lightCapable = false
      } else if (info.size > policy.trivialMaxBytes) {
        lightCapable = false
      }
    }
    const located = isLocatedUnder(workspaceRoot, absolute) || tempRoots.some((root) => isLocatedUnder(root, absolute))
    if (!located) lightCapable = false
  }

  const tier: DeleteTier = strict ? 'strict' : lightCapable ? 'light' : 'standard'
  return { tier, allPlainFiles }
}
