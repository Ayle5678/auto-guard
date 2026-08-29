/**
 * Explicit factory-rule update for existing installs (ADR-0013, spec 0006):
 * compare the shipped defaults against the two-layer rule files in every
 * host config root that exists, list the pattern entries the local files are
 * missing and — only on explicit or interactively confirmed consent — append
 * them (idempotent, dedup, `*.auto-guard.bak` backup before the first write).
 * Runtime loading never merges entries silently; this step is the one
 * sanctioned upgrade path. `remove` semantics are untouched: rule files are
 * user data and stay on disk.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDefaults } from '@auto-guard/core'
import type { PatternRule, RulesFile } from '@auto-guard/core'
import { message, type Lang } from './i18n.ts'
import { PROFILES } from './profiles.ts'

/** Pattern-array RulesFile fields the update compares (sensitivePaths is not pattern data). */
const PATTERN_FIELDS = ['staticAllow', 'hardDeny', 'directoryDelete', 'userConfirmed', 'cacheable', 'alwaysReview'] as const
type PatternField = (typeof PATTERN_FIELDS)[number]

/** Entries of `shipped` that `local` lacks, by case-insensitive pattern identity. */
function missingEntries(shipped: PatternRule[], local: unknown): PatternRule[] {
  const present = new Set(
    Array.isArray(local)
      ? local.filter(isPatternRule).map((rule) => rule.pattern.trim().toLowerCase())
      : [],
  )
  const out: PatternRule[] = []
  for (const entry of shipped) {
    const key = entry.pattern.trim().toLowerCase()
    if (present.has(key)) continue
    present.add(key)
    out.push(entry)
  }
  return out
}

function isPatternRule(value: unknown): value is PatternRule {
  return typeof value === 'object' && value !== null && typeof (value as PatternRule).pattern === 'string'
}

/** One rule file due for an append, with its full next content planned up front. */
export interface RuleFileUpdate {
  file: string
  /** `~`-relative path for human output. */
  displayPath: string
  backupFile: string
  content: string
}

export interface RuleUpdateBlocked {
  file: string
  displayPath: string
  reason: string
}

export interface RuleUpdatePreviewEntry {
  field: PatternField
  pattern: string
  reason?: string
}

export interface RuleUpdatePlan {
  updates: RuleFileUpdate[]
  blocked: RuleUpdateBlocked[]
  /** Unique missing entries across all files — the diff preview. */
  preview: RuleUpdatePreviewEntry[]
}

export interface BuildRuleUpdateOptions {
  lang?: Lang
  /** Shipped defaults stand-in (tests); default reads the factory rules.json. */
  shipped?: RulesFile
  /** Content snapshot: file text or null when absent (tests inject this). */
  readFile?: (p: string) => string | null
}

function defaultReadFile(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

function parseRuleFile(raw: string): RulesFile | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as RulesFile
  } catch {
    return null
  }
}

/** Build the append plan for every existing host config root under `home`. */
export function buildRuleUpdatePlan(home: string, options: BuildRuleUpdateOptions = {}): RuleUpdatePlan {
  const lang = options.lang ?? 'zh'
  const readFile = options.readFile ?? defaultReadFile
  const shipped = options.shipped ?? readDefaults()
  const plan: RuleUpdatePlan = { updates: [], blocked: [], preview: [] }

  const previewSeen = new Set<string>()
  for (const profile of PROFILES) {
    const root = join(home, profile.configRoot)
    const defaultsFile = join(root, 'defaults.json')
    const rulesFile = join(root, 'rules.json')
    const defaultsRaw = readFile(defaultsFile)
    const rulesRaw = readFile(rulesFile)
    if (defaultsRaw === null || rulesRaw === null) continue

    for (const [file, raw] of [[defaultsFile, defaultsRaw], [rulesFile, rulesRaw]] as const) {
      const displayPath = `~/${file.slice(home.length + 1).replaceAll('\\', '/')}`
      const doc = parseRuleFile(raw)
      if (!doc) {
        plan.blocked.push({ file, displayPath, reason: message(lang, 'unparseableRefuseModify', { file: displayPath }) })
        continue
      }
      let changed = false
      for (const field of PATTERN_FIELDS) {
        const entries = missingEntries(shipped[field], doc[field])
        if (!entries.length) continue
        // Append only: the existing array (whatever it contains) is preserved verbatim.
        doc[field] = [...(Array.isArray(doc[field]) ? doc[field] : []), ...entries]
        changed = true
        for (const entry of entries) {
          const key = `${field}:${entry.pattern.trim().toLowerCase()}`
          if (!previewSeen.has(key)) {
            previewSeen.add(key)
            plan.preview.push({ field, pattern: entry.pattern, reason: entry.reason })
          }
        }
      }
      if (!changed) continue
      plan.updates.push({
        file,
        displayPath,
        backupFile: `${file}.auto-guard.bak`,
        content: `${JSON.stringify(doc, null, 2)}\n`,
      })
    }
  }
  return plan
}

export interface RuleUpdateApplyOptions {
  /** Output language for failure errors it produces itself (default zh). */
  lang?: Lang
}

export interface RuleUpdateApplyOutcome {
  ok: boolean
  written: string[]
  failedFile?: string
  error?: string
}

/** Execute the planned appends: backup (only if absent) → write → verify. */
export function applyRuleUpdate(updates: readonly RuleFileUpdate[], options: RuleUpdateApplyOptions = {}): RuleUpdateApplyOutcome {
  const lang = options.lang ?? 'zh'
  const outcome: RuleUpdateApplyOutcome = { ok: true, written: [] }
  for (const update of updates) {
    try {
      if (!existsSync(update.backupFile)) {
        copyFileSync(update.file, update.backupFile)
      }
      writeFileSync(update.file, update.content, 'utf8')
      if (readFileSync(update.file, 'utf8') !== update.content) {
        return { ...outcome, ok: false, failedFile: update.file, error: message(lang, 'verifyMismatch') }
      }
      outcome.written.push(update.file)
    } catch (error) {
      return { ...outcome, ok: false, failedFile: update.file, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return outcome
}
