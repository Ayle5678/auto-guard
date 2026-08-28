/**
 * Learned rules: a separate, lowest-priority rule layer generated from audit
 * history. It never writes into user `rules.json` or shipped `defaults.json`.
 *
 * The learned layer only produces `cacheable` templates. `staticAllow` and
 * `staticAllowGuards` are intentionally not learned: safe read-only commands
 * belong in the preset/user whitelist, not in an auto-generated allowlist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AuditRow } from './audit.ts'
import { splitShellCommand } from './command.ts'
import { fixedTokensAfterFirst, skeletonHasPlaceholder, skeletonOf } from './skeleton.ts'
import { matchRule } from './rules.ts'
import { shellCommandHasSensitivePath } from './sensitive-path.ts'
import type { PatternRule } from './types.ts'

export interface LearnedRulesFile {
  version: 1
  cacheable: PatternRule[]
}

export function emptyLearnedRules(): LearnedRulesFile {
  return { version: 1, cacheable: [] }
}

function dedupePatterns(patterns: PatternRule[]): PatternRule[] {
  const seen = new Set<string>()
  const result: PatternRule[] = []
  for (const rule of patterns) {
    if (seen.has(rule.pattern)) continue
    seen.add(rule.pattern)
    result.push(rule)
  }
  return result
}

export function loadLearnedRules(path: string, excludedRules: PatternRule[] = []): LearnedRulesFile {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { cacheable?: unknown }
    const cacheable = Array.isArray(parsed.cacheable)
      ? parsed.cacheable.filter((rule): rule is PatternRule => {
          return typeof rule === 'object' && rule !== null && typeof (rule as PatternRule).pattern === 'string'
        })
      : []
    const filtered = cacheable.filter((rule) => {
      const first = rule.pattern.split(/\s+/)[0]?.toLowerCase()
      if (NON_LEARNABLE_CACHEABLE.has(first)) return false
      if (excludedRules.length > 0 && matchRule(rule.pattern, excludedRules)) return false
      return true
    })
    return {
      version: 1,
      cacheable: dedupePatterns(filtered),
    }
  } catch {
    return emptyLearnedRules()
  }
}

export function writeLearnedRules(path: string, backupPath: string, rules: LearnedRulesFile): void {
  if (existsSync(path)) {
    mkdirSync(dirname(backupPath), { recursive: true })
    writeFileSync(backupPath, readFileSync(path, 'utf8'), { encoding: 'utf8' })
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(rules, null, 2)}\n`, { encoding: 'utf8' })
}

export function restoreLearnedRules(path: string, backupPath: string): boolean {
  if (!existsSync(backupPath)) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, readFileSync(backupPath, 'utf8'), { encoding: 'utf8' })
  return true
}

/**
 * First-command blacklist for cacheable learning.
 *
 * These commands are simple read-only utilities already covered by the
 * preset/user whitelist, or commands whose broad wildcard forms can read file
 * contents and bypass the sensitive-path guard. They must not be learned as
 * cacheable templates.
 */
const NON_LEARNABLE_CACHEABLE = new Set([
  'cat',
  'grep',
  'rg',
  'sed',
  'awk',
  'head',
  'tail',
  'sort',
  'cut',
  'tr',
  'uniq',
  'wc',
  'find',
  'fd',
  'ls',
  'pwd',
  'echo',
  'printf',
  'stat',
  'file',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'which',
  'type',
  'command',
  'date',
  'get-childitem',
  'get-content',
  'select-object',
  'where-object',
  'format-table',
  'get-date',
  'get-location',
])

export interface LearnedRuleGenerationOptions {
  days: number
  cacheableMinTotal: number
  cacheableMinLlm: number
  sensitivePaths: string[]
  /** hardDeny + alwaysReview + directoryDelete patterns; matching skeletons are never learned. */
  excludedRules: PatternRule[]
}

function patternFromSkeleton(skeleton: string): string {
  const tokens = skeleton.split(/\s+/)
  const parts: string[] = []
  for (const token of tokens) {
    if (/^<[a-z]+>$/.test(token)) {
      if (parts[parts.length - 1] !== '*') parts.push('*')
    } else {
      parts.push(token.replace(/<[a-z]+>/g, '*'))
    }
  }
  if (parts.length === 0) parts.push('*')
  return parts.join(' ')
}

function isEligibleRow(row: AuditRow, cutoff: string): boolean {
  if (row.recorded_at < cutoff) return false
  if (row.reviewer_failed !== 0) return false
  if (row.risk !== 'low') return false
  return true
}

interface CacheableEntry {
  total: number
  llm: number
  denies: number
  excluded: boolean
  sample: string
}

export function generateLearnedRules(rows: AuditRow[], options: LearnedRuleGenerationOptions): LearnedRulesFile {
  const cutoff = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString()
  const fullMap = new Map<string, CacheableEntry>()

  const record = (skeleton: string, row: AuditRow, excluded: boolean) => {
    const entry = fullMap.get(skeleton) ?? { total: 0, llm: 0, denies: 0, excluded: false, sample: row.command_normalized }
    if (excluded) entry.excluded = true
    if ((row.decision_kind === 'deny' || row.final_action === 'block') && row.reviewer_failed === 0) {
      entry.denies++
    } else if (row.decision_kind === 'allow' && row.final_action === 'allow' && row.risk === 'low') {
      entry.total++
      if (row.decision_source === 'llm' && row.reviewer_failed === 0) entry.llm++
    }
    fullMap.set(skeleton, entry)
  }

  for (const row of rows) {
    if (!isEligibleRow(row, cutoff)) continue
    const command = row.command_normalized
    if (command.includes('$(') || command.includes('`') || /[<>]/.test(command)) continue
    if (shellCommandHasSensitivePath(command, options.sensitivePaths)) continue
    const excluded = splitShellCommand(command, true).some((part) => part && matchRule(part, options.excludedRules) !== undefined)
    const fullSkeleton = skeletonOf(command)
    record(fullSkeleton, row, excluded)
  }

  const cacheable: PatternRule[] = []
  for (const [skeleton, entry] of fullMap) {
    if (entry.denies > 0 || entry.excluded) continue
    if (entry.total < options.cacheableMinTotal || entry.llm < options.cacheableMinLlm) continue
    const tokens = skeleton.split(/\s+/)
    const first = tokens[0]?.toLowerCase()
    if (NON_LEARNABLE_CACHEABLE.has(first)) continue
    if (fixedTokensAfterFirst(skeleton) < 2) continue
    if (!skeletonHasPlaceholder(skeleton)) continue
    cacheable.push({
      pattern: patternFromSkeleton(skeleton),
      reason: `Learned from ${entry.total} historical low-risk allows (${entry.llm} LLM): ${entry.sample}`,
    })
  }

  const unique = dedupePatterns(cacheable)
  unique.sort((a, b) => a.pattern.localeCompare(b.pattern))
  return { version: 1, cacheable: unique }
}
