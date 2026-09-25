/**
 * Directory-delete review protocol (ADR-0021 / SPEC 0019).
 *
 * Everything the `[删除理由]` review flow needs except the LLM call itself:
 * the retry state machine over the pending-delete store (prune → exact key →
 * same-session neighbor), the marker text protocol, the deletion-target
 * parsing and the deletion-reason extraction from the request and its session
 * events. The guard pipeline (`decideDirectoryDelete`) orchestrates these and
 * owns only the decision shaping and the LLM step.
 */
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSessionKey, splitSessionKey } from './cache.ts'
import { normalizeCommand, normalizePath, splitShellCommand } from './command.ts'
import { classifyCommand } from './rules.ts'
import type { GuardRequest, RulesFile } from './types.ts'

/** A pending first-hit directory delete, awaiting a `[删除理由]` retry. */
export interface PendingDirectoryDelete {
  deniedAt: number
  /** Original command text at first denial, for the deny echo (absent in legacy entries). */
  command?: string
}

/**
 * Pending deletes older than this are pruned on touch instead of being matched:
 * the `[删除理由]` retry is a same-session, minutes-scale flow. The window also
 * bounds pending-deletes.json against stale rows (24h mirrors pruneSessions'
 * idle-directory window).
 */
const PENDING_DELETE_TTL_MS = 24 * 60 * 60 * 1000

/** Command words whose non-flag arguments are deletion targets. */
const DELETE_COMMAND_WORDS = new Set(['rm', 'rd', 'rmdir', 'del', 'erase', 'remove-item', 'ri'])

/** cmd builtins whose `/x`-style short flags must not count as targets. */
const WINDOWS_FLAG_DELETE_WORDS = new Set(['rd', 'rmdir', 'del', 'erase'])

/** Read/write view the retry matcher needs of the pending-delete store. */
export interface PendingDeleteStore {
  get(key: string): PendingDirectoryDelete | undefined
  set(key: string, entry: PendingDirectoryDelete): void
  delete(key: string): void
  entries(): Iterable<[string, PendingDirectoryDelete]>
}

/** Drop pending deletes older than the retry TTL so the JSON sink stays bounded. */
export function pruneExpiredPendingDeletes(store: PendingDeleteStore): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (isExpiredPendingDelete(entry, now)) store.delete(key)
  }
}

/**
 * Find the pending delete a retry lands on: the exact key first, then the
 * most recent same-session pending whose deletion targets equal the retry's —
 * never expired. Entries with no extractable targets (e.g. a first block on
 * syntax the extractor cannot tokenize) never match, so a miss degrades to a
 * fresh denial, never a wrong reuse.
 */
export function matchPending(
  store: PendingDeleteStore,
  request: Pick<GuardRequest, 'session' | 'workspace'>,
  command: string,
  rules: RulesFile,
): { key: string; entry: PendingDirectoryDelete } | undefined {
  pruneExpiredPendingDeletes(store)
  const key = buildSessionKey(request.session, request.workspace, command.toLowerCase())
  const exact = store.get(key)
  if (exact) return { key, entry: exact }

  // A cleaned `[删除理由]` retry often differs textually from the recorded
  // original (compound first block vs standalone retry, comment residue,
  // workspace drift) — fall back to same-session neighbor reuse instead of
  // stacking another denial.
  const targets = extractDeletionTargets(command, rules)
  if (targets.length === 0) return undefined
  const sessionPrefix = `${request.session ?? '<no-session>'}|`
  const now = Date.now()
  let best: { key: string; entry: PendingDirectoryDelete } | undefined
  for (const [neighborKey, entry] of store.entries()) {
    if (!neighborKey.startsWith(sessionPrefix)) continue
    if (isExpiredPendingDelete(entry, now)) continue
    const parts = splitSessionKey(neighborKey)
    if (!sameWorkspaceRoot(parts.workspace, request.workspace)) continue
    if (!recordsSameDeletion(parts.command, targets, rules)) continue
    if (!best || entry.deniedAt > best.entry.deniedAt) best = { key: neighborKey, entry }
  }
  return best
}

/**
 * The deletion reason for a retry, in priority order: the explicitly supplied
 * reason (interactive UI or headless marker) first, then a `[删除理由]` marker
 * in the command itself, then an assistant message in the session events
 * carrying the marker after the original denial.
 */
export function extractDeletionReason(
  request: Pick<GuardRequest, 'deletionReason' | 'command' | 'events'>,
  afterTime: number,
): string | undefined {
  // Preferred: reason supplied by the interactive UI (or headless marker).
  if (request.deletionReason && request.deletionReason.trim()) {
    return request.deletionReason.trim().slice(0, 2800)
  }
  // Fallback: scan the command itself for a [删除理由] marker.
  const commandReason = extractMarkerReason(request.command)
  if (commandReason) return commandReason
  // Last resort: scan session events for an assistant message with the marker.
  const events = request.events
  if (!Array.isArray(events)) return undefined
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const candidate = event as { type?: unknown; time?: unknown; data?: unknown }
    if (candidate.type !== 'assistant/message') continue
    if (typeof candidate.time !== 'number' || candidate.time <= afterTime) continue
    const text = messageText(candidate.data)
    const markerIndex = text.indexOf('[删除理由]')
    if (markerIndex >= 0) {
      const reason = text.slice(markerIndex + '[删除理由]'.length).trim()
      if (reason) return reason.slice(0, 2800)
    }
  }
  return undefined
}

function messageText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const message = (data as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const textBlock = block as { type?: unknown; text?: unknown }
      return textBlock.type === 'text' && typeof textBlock.text === 'string' ? textBlock.text : ''
    })
    .join('')
}

/** True when the command is a PowerShell Remove-Item invocation (runtime directory detection). */
export function isRemoveItemInvocation(command: string): boolean {
  return /\bremove-item\b/i.test(command)
}

/**
 * stat-based target type of a Remove-Item invocation's target. `unknown` when
 * nothing extractable exists or the target cannot be stat-ed — the pipeline
 * treats it as a normal review, never as a delete.
 */
export async function removeItemTargetTypeOf(workspace: string | undefined, command: string): Promise<'directory' | 'file' | 'unknown'> {
  const target = extractRemoveItemPath(command)
  if (!target) return 'unknown'
  const absolute = resolve(workspace ?? process.cwd(), target)
  try {
    const info = await stat(absolute)
    return info.isDirectory() ? 'directory' : 'file'
  } catch {
    return 'unknown'
  }
}

function extractRemoveItemPath(command: string): string | undefined {
  const match = /\bremove-item\b/i.exec(command)
  if (!match) return undefined
  const rest = command.slice(match.index + match[0].length).trim()
  const stripQuotes = (value: string): string => value.replace(/^["']|["']$/g, '')
  const quotedPath = /(?:^|\s)(?:-path|-literalpath)\s+("(?:[^"]*)"|'(?:[^']*)')/i.exec(rest)
  if (quotedPath) return stripQuotes(quotedPath[1])
  const unquotedPath = /(?:^|\s)(?:-path|-literalpath)\s+([^\s;"'|&]+)/i.exec(rest)
  if (unquotedPath) return unquotedPath[1]
  const tokens = rest.match(/("(?:[^"]*)"|'(?:[^']*)'|[^\s;"'|&]+)/g) ?? []
  for (const token of tokens) {
    const value = stripQuotes(token)
    if (value && !value.startsWith('-')) return value
  }
  return undefined
}

/** Extract a `[删除理由] <reason>` marker from a command line (headless retry).
 *  Returns the reason and the command with the marker stripped. */
export function extractDeletionMarker(command?: string): { reason: string; cleaned: string } | undefined {
  if (!command) return undefined
  const idx = command.indexOf('[删除理由]')
  if (idx < 0) return undefined
  const reason = command.slice(idx + '[删除理由]'.length).trim()
  if (!reason) return undefined
  const cleaned = stripTrailingCommentTokens(command.slice(0, idx))
  return { reason: reason.slice(0, 2800), cleaned }
}

/** Extract just the `[删除理由]` reason text from a command line, if present. */
export function extractMarkerReason(command?: string): string | undefined {
  return extractDeletionMarker(command)?.reason
}

/**
 * Prepare a headless directory-delete retry: strip the `[删除理由]` marker from
 * the command and supply it as the explicit deletion reason, so the marker is
 * never left in the command that actually executes.
 */
export function prepareDeletionMarker(request: GuardRequest): { request: GuardRequest; cleanedCommand?: string } {
  const marker = extractDeletionMarker(request.command)
  if (!marker) return { request }
  return {
    request: { ...request, command: marker.cleaned, deletionReason: marker.reason },
    cleanedCommand: marker.cleaned || undefined,
  }
}

/**
 * Drop comment markers left between the command and an appended `[删除理由]`
 * retry marker (`rm -rf x # [删除理由] r` must clean to `rm -rf x`, not
 * `rm -rf x #`). Only whole trailing tokens are removed: `foo#` is a real
 * path character, and the cleaned text is the command that actually executes.
 */
function stripTrailingCommentTokens(text: string): string {
  let cleaned = text.trim()
  for (;;) {
    const stripped = cleaned.replace(/\s+(?:#|%%)$/, '')
    if (stripped === cleaned) return cleaned
    cleaned = stripped.trim()
  }
}

/** True when a pending delete is past the retry window and must not be matched again. */
function isExpiredPendingDelete(entry: PendingDirectoryDelete, now: number): boolean {
  return now - entry.deniedAt > PENDING_DELETE_TTL_MS
}

/** Windows paths are case-insensitive; POSIX is not — fold only on Windows so target equality stays exact elsewhere. */
function foldPathCase(text: string): string {
  return process.platform === 'win32' ? text.toLowerCase() : text
}

/** Normalize a workspace for comparison: unified separators, no trailing slash, case-folded on Windows. */
function normalizeWorkspace(workspace: string): string {
  return foldPathCase(normalizePath(workspace).replace(/\/+$/, ''))
}

/**
 * True when both workspaces describe the same subtree: equal after
 * normalization, or one a whole path-segment prefix of the other. The
 * effective workspace can shift between the first denial and the retry (hook
 * cwd fallback resolves differently around `cd`), but never across projects.
 */
function sameWorkspaceRoot(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const na = normalizeWorkspace(a)
  const nb = normalizeWorkspace(b)
  if (na === nb) return true
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return long.startsWith(`${short}/`)
}

/** True when a recorded command deletes exactly the given normalized targets. */
function recordsSameDeletion(recordedCommand: string, targets: string[], rules: RulesFile): boolean {
  const recorded = extractDeletionTargets(recordedCommand, rules)
  return recorded.length > 0 && recorded.join('\n') === targets.join('\n')
}

/**
 * Quote-aware deletion-target tokens of every directory-delete segment in a
 * command, normalized and sorted — the comparable shape for pending retry
 * alignment. Only segments that classify as directory-delete contribute, so
 * `ls` companions in a compound never count as targets, and a pipeline or
 * redirect tail after an operator ends the argument list.
 */
export function extractDeletionTargets(command: string, rules: RulesFile): string[] {
  const collected = new Set<string>()
  for (const segment of splitShellCommand(normalizeCommand(command))) {
    if (classifyCommand(segment, rules).category !== 'directory-delete') continue
    for (const target of deletionTargetsFromSegment(segment)) {
      const normalized = normalizeTargetToken(target)
      if (normalized) collected.add(normalized)
    }
  }
  return [...collected].sort()
}

/** Module-surface alias of {@link extractDeletionTargets} (SPEC 0019 ticket 01). */
export const targetsOf = extractDeletionTargets

/** Extract raw target tokens from one already-classified delete segment. */
function deletionTargetsFromSegment(segment: string): string[] {
  const markerIdx = segment.indexOf('[删除理由]')
  const body = markerIdx >= 0 ? segment.slice(0, markerIdx) : segment
  const tokens = segmentTokens(body)
  if (tokens.length === 0) return []
  let word = tokens[0].toLowerCase()
  let rest = tokens.slice(1)
  // `cmd /c <builtin>` and `command <builtin>` wrapping shift the command word.
  if ((word === 'cmd' || word === 'command') && rest.length > 0 && /^\/[ck]$/i.test(rest[0])) {
    word = (rest[1] ?? '').toLowerCase()
    rest = rest.slice(2)
  }
  if (!DELETE_COMMAND_WORDS.has(word)) return []
  const windowsFlags = WINDOWS_FLAG_DELETE_WORDS.has(word)
  const targets: string[] = []
  let positionalOnly = false
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!positionalOnly) {
      if (token === '--') {
        positionalOnly = true
        continue
      }
      if (token.startsWith('-')) {
        const lower = token.toLowerCase()
        // Remove-Item's named path parameters consume the next token as the target.
        if ((lower === '-path' || lower === '-literalpath') && i + 1 < rest.length) targets.push(rest[++i])
        continue
      }
    }
    if (/[|<>&]/.test(token)) break
    if (token === '#' || token === '%%') continue
    if (windowsFlags && /^\/[a-z0-9]+$/i.test(token)) continue
    targets.push(token)
  }
  return targets
}

/** Whitespace/quote-aware token split of one command segment; backslashes are ordinary characters (Windows path separators). */
function segmentTokens(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) {
        quote = undefined
        if (current) tokens.push(current)
        current = ''
      } else {
        current += ch
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

/** Comparable shape of one deletion target: quotes and trailing separators stripped, separators unified, case-folded on Windows. */
function normalizeTargetToken(token: string): string {
  const stripped = token.replace(/^["']|["']+$/g, '').replace(/[\\/]+$/, '')
  return stripped ? foldPathCase(normalizePath(stripped)) : ''
}
