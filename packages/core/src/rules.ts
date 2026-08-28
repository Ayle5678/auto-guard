/**
 * Rule file loading, defaults provisioning, pattern matching and command
 * classification.
 *
 * Rules live outside the repo:
 *  - `defaults.json` is an editable copy of the shipped defaults in the host's
 *    config root; the adapter reads this copy, not the source file.
 *  - `rules.json` is the user override file; fields it does not define are
 *    filled from `defaults.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeCommand, splitShellCommand } from './command.ts'
import type { CommandCategory, PatternRule, RulesFile, StaticAllowGuard } from './types.ts'

export const RULES_ROOT = 'defaults'
export const DEFAULT_RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', RULES_ROOT, 'rules.json')

/** Create `dir` if missing; returns the path. */
export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Read the shipped default rules (seed only; runtime reads the config-root copy). */
export function readDefaults(defaultPath?: string): RulesFile {
  const raw = readFileSync(defaultPath ?? DEFAULT_RULES_FILE, 'utf8')
  return JSON.parse(raw) as RulesFile
}

/** Copy the shipped defaults to a config-root path on first run (no-op after). */
export function provisionDefaultRulesFile(defaultPath: string): void {
  if (existsSync(defaultPath)) return
  mkdirSync(dirname(defaultPath), { recursive: true })
  const defaults = JSON.stringify(readDefaults(), null, 2)
  writeFileSync(defaultPath, `${defaults}\n`, { encoding: 'utf8', flag: 'wx' })
}

function emptyRules(): RulesFile {
  // The user override file is intentionally sparse: absent fields are filled
  // from the config-root defaults by mergeMissingRuleFields.
  return { version: 1 } as RulesFile
}

/** Create an empty user override file on first run (no-op after). */
export function provisionRulesFile(userPath: string): void {
  if (existsSync(userPath)) return
  mkdirSync(dirname(userPath), { recursive: true })
  writeFileSync(userPath, `${JSON.stringify(emptyRules(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

/**
 * Merge default rule fields into a user rules file for fields the user file is
 * missing. User-owned fields are never overwritten. Returns true when the user
 * file was changed and should be written back.
 */
export function mergeMissingRuleFields(defaults: RulesFile, user: RulesFile): boolean {
  let changed = false
  const keys: Array<keyof RulesFile> = [
    'staticAllow',
    'hardDeny',
    'directoryDelete',
    'userConfirmed',
    'cacheable',
    'alwaysReview',
    'staticAllowGuards',
    'sensitivePaths',
  ]
  for (const key of keys) {
    if (!Array.isArray(user[key])) {
      ;(user as unknown as Record<string, unknown>)[key] = defaults[key]
      changed = true
    }
  }
  return changed
}

/**
 * Load the effective rules.
 *
 * The config-root defaults file is provisioned from the shipped source on
 * first run; afterwards the adapter reads that copy. The user override file is
 * merged over it for any missing top-level fields.
 */
export function loadRules(userPath: string, defaultPath?: string): RulesFile {
  const defaultsPath = defaultPath ?? DEFAULT_RULES_FILE
  provisionDefaultRulesFile(defaultsPath)
  provisionRulesFile(userPath)
  const defaults = readDefaults(defaultsPath)
  // Keep the user-editable defaults copy self-healing: missing top-level fields
  // introduced by newer shipped defaults are filled in without overwriting edits.
  const sourceDefaults = readDefaults()
  if (mergeMissingRuleFields(sourceDefaults, defaults)) {
    writeFileSync(defaultsPath, `${JSON.stringify(defaults, null, 2)}\n`, { encoding: 'utf8' })
  }
  const raw = readFileSync(userPath, 'utf8')
  const user = JSON.parse(raw) as RulesFile
  if (mergeMissingRuleFields(defaults, user)) {
    writeFileSync(userPath, `${JSON.stringify(user, null, 2)}\n`, { encoding: 'utf8' })
  }
  return user
}

function globToRegExp(pattern: string): RegExp {
  // Escape all regex metacharacters, then replace `*` with `.*`.
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** Match a normalized command against a single rule pattern. */
export function matchPattern(command: string, pattern: string): boolean {
  const normalizedCommand = normalizeCommand(command)
  const normalizedPattern = normalizeCommand(pattern)
  if (!normalizedPattern.includes('*')) return normalizedCommand.toLowerCase() === normalizedPattern.toLowerCase()
  return globToRegExp(normalizedPattern).test(normalizedCommand)
}

/** Match a command against a list of rules, returning the first match. */
export function matchRule(command: string, rules: PatternRule[]): PatternRule | undefined {
  return rules.find((rule) => matchPattern(command, rule.pattern))
}

/** Strip one layer of wrapping single/double quotes from a token. */
export function stripOuterQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1)
    }
  }
  return token
}

/** Split a normalized command into whitespace tokens with wrapping quotes removed. */
export function commandTokens(command: string): string[] {
  return normalizeCommand(command)
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(stripOuterQuotes)
}

/** True when a static-allow guard applies to a command (anchored `when` + exact token flag). */
export function matchStaticAllowGuard(command: string, guard: StaticAllowGuard): boolean {
  if (!matchPattern(command, guard.when)) return false
  const flags = new Set(guard.flags.map((flag) => flag.toLowerCase()))
  return commandTokens(command).some((token) => {
    const normalizedToken = token.toLowerCase()
    if (flags.has(normalizedToken)) return true
    // Support `--flag=value` forms while keeping the existing exact token
    // semantics for short flags (do not treat `-describe` as `-d`).
    const equalsIndex = normalizedToken.indexOf('=')
    return equalsIndex > 0 && flags.has(normalizedToken.slice(0, equalsIndex))
  })
}

/** Return the first static-allow guard that downgrades a command to LLM review. */
export function staticAllowGuardHit(command: string, rules: RulesFile): StaticAllowGuard | undefined {
  return rules.staticAllowGuards.find((guard) => matchStaticAllowGuard(command, guard))
}

function globToSearchRegExp(pattern: string): RegExp {
  // Same escaping as globToRegExp but without anchoring, so the pattern can be
  // found anywhere in a command — including inside quoted strings.
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(escaped, 'i')
}

/**
 * True when a hard-deny or always-review rule pattern appears anywhere in the
 * command text, including inside quotes. Used as a conservative extra gate
 * before allowing low-risk state-changing compounds: a quoted `rm -rf /` may
 * be data, but treating it as dangerous only costs an LLM review.
 */
export function containsDangerousPattern(command: string, rules: RulesFile): boolean {
  const normalized = normalizeCommand(command)
  const patterns = [...rules.hardDeny, ...rules.alwaysReview]
  return patterns.some((rule) => {
    const normalizedPattern = normalizeCommand(rule.pattern)
    if (!normalizedPattern.includes('*')) {
      return normalized.toLowerCase().includes(normalizedPattern.toLowerCase())
    }
    return globToSearchRegExp(normalizedPattern).test(normalized)
  })
}

export interface Classification {
  category: CommandCategory
  rule?: PatternRule
}

function classifySimple(command: string, rules: RulesFile): Classification {
  const normalized = normalizeCommand(command)

  const hardDeny = matchRule(normalized, rules.hardDeny)
  if (hardDeny) return { category: 'hard-deny', rule: hardDeny }

  const directoryDelete = matchRule(normalized, rules.directoryDelete)
  if (directoryDelete) return { category: 'directory-delete', rule: directoryDelete }

  const alwaysReview = matchRule(normalized, rules.alwaysReview)
  if (alwaysReview) return { category: 'always-review', rule: alwaysReview }

  const staticAllow = matchRule(normalized, rules.staticAllow)
  if (staticAllow) return { category: 'static-allow', rule: staticAllow }

  const userConfirmed = matchRule(normalized, rules.userConfirmed)
  if (userConfirmed) return { category: 'user-confirmed', rule: userConfirmed }

  const cacheable = matchRule(normalized, rules.cacheable)
  if (cacheable) return { category: 'cacheable', rule: cacheable }

  return { category: 'unknown' }
}

/**
 * Classify a command.
 *
 * For compound commands (`;`, `&&`, `||`) this returns the most restrictive
 * category found in any subcommand, so the synchronous monotonic guard still
 * sees a hard-deny hidden inside a compound command. The full guard pipeline
 * performs finer per-subcommand review in GuardService.
 *
 * Order matters: hard-deny rules run before static allow so a command that is
 * both dangerous and allowlisted is still denied by the monotonic guard.
 */
export function classifyCommand(command: string, rules: RulesFile): Classification {
  const normalized = normalizeCommand(command)
  const segments = splitShellCommand(normalized)
  if (segments.length > 1) {
    let sawCacheable = false
    let sawUserConfirmed = false
    let sawStaticAllow = false

    for (const segment of segments) {
      const classification = classifySimple(segment, rules)
      if (
        classification.category === 'hard-deny' ||
        classification.category === 'directory-delete' ||
        classification.category === 'always-review' ||
        classification.category === 'unknown'
      ) {
        return classification
      }
      if (classification.category === 'cacheable') sawCacheable = true
      if (classification.category === 'user-confirmed') sawUserConfirmed = true
      if (classification.category === 'static-allow') sawStaticAllow = true
    }

    if (sawCacheable) return { category: 'cacheable' }
    if (sawUserConfirmed) return { category: 'user-confirmed' }
    if (sawStaticAllow) return { category: 'static-allow' }
    return { category: 'unknown' }
  }

  // This classifier deliberately reports pipelines as restrictive or unknown
  // only; deterministic pipeline-leaf allow decisions live in GuardService
  // (ADR-0018). Dangerous stages must still be visible to the synchronous guard
  // and special flows. Only RESTRICTIVE whole-pipeline rules (e.g.
  // `curl *|*bash*`) may short-circuit here; a permissive whole-pipeline match
  // (e.g. `echo *` swallowing `x | rm -rf /`) must NOT approve a pipeline, so
  // fall through to the stage scan which only ever returns restrictive
  // categories or unknown (→ LLM review).
  const pipelineStages = splitShellCommand(normalized, true)
  if (pipelineStages.length > 1) {
    const whole = classifySimple(normalized, rules)
    if (
      whole.category === 'hard-deny' ||
      whole.category === 'directory-delete' ||
      whole.category === 'always-review'
    ) {
      return whole
    }
    for (const stage of pipelineStages) {
      const classification = classifySimple(stage, rules)
      if (
        classification.category === 'hard-deny' ||
        classification.category === 'directory-delete' ||
        classification.category === 'always-review'
      ) {
        return classification
      }
    }
    return { category: 'unknown' }
  }

  return classifySimple(normalized, rules)
}
