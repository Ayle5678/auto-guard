/**
 * Sensitive path gate for write/edit/read tool calls.
 *
 * We never read or review file content; only the target path is checked.
 */
import { normalizePath } from './command.ts'
import { commandTokens, matchPattern } from './rules.ts'
import type { Decision } from './types.ts'

/** Match a single configured sensitive pattern against a path. */
export function matchesSensitivePath(path: string, pattern: string): boolean {
  const normalized = normalizePath(path)
  const normalizedPattern = normalizePath(pattern)

  // Directory-style patterns match the directory itself and any path under it.
  if (normalizedPattern.endsWith('/')) {
    const dirPattern = normalizedPattern.slice(0, -1)
    return normalized === dirPattern || normalized.endsWith(`/${dirPattern}`) || normalized.includes(normalizedPattern)
  }

  // Bare name patterns like `credentials` / `id_rsa` match any basename.
  if (!normalizedPattern.includes('/')) {
    const base = normalized.slice(normalized.lastIndexOf('/') + 1)
    return matchPattern(base, normalizedPattern) || matchPattern(normalized, normalizedPattern)
  }

  return matchPattern(normalized, normalizedPattern)
}

/** True when a path matches at least one configured sensitive pattern. */
export function isSensitivePath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesSensitivePath(path, pattern))
}

/**
 * True when a shell command references at least one configured sensitive path.
 * Tokens are whitespace-split with wrapping quotes removed; directory-style
 * patterns use path containment and bare-name/glob patterns use basename
 * matching, so `head .env`, `sort ~/.ssh/known_hosts`, and `file *.pem` are
 * all detected.
 */
export function shellCommandHasSensitivePath(command: string, patterns: readonly string[]): boolean {
  return commandTokens(command).some((token) => isSensitivePath(token, patterns))
}

/** Build the ask decision for a sensitive path hit. */
export function sensitivePathDecision(path: string, reason?: string): Decision {
  return {
    kind: 'ask',
    source: 'sensitive-path',
    reason: reason ?? `Path is on the sensitive list and needs confirmation: ${path}`,
  }
}
