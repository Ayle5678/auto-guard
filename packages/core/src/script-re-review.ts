/**
 * Script attach-recheck input resolution (SPEC 0027 A3): find the local
 * script behind an "interpreter + script" command unit and read its whole
 * text when it fits the attach limits. The re-review itself and its
 * exclusions (sensitive demotion, delete flow, write-then-execute, reviewer
 * failures, pending-deny asks) live at the GuardService call site.
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { expandHome, normalizeCommand, segmentTokens, splitShellCommand } from './command.ts'

/** Attach limits (SPEC 0027 A3): the whole file or nothing — a truncated fragment misleads more than it informs. */
const MAX_LINES = 100
const MAX_BYTES = 16 * 1024
/** Non-printable share above which a file counts as undecodable binary. */
const MAX_BINARY_RATIO = 0.05

export interface ScriptLookup {
  /** The command unit under review (single command, pipeline whole, one compound segment or a whole compound). */
  unit: string
  /** The full command text; its leading `cd`/`pushd` segments advance relative resolution. */
  wholeCommand: string
  workspace?: string
  /** Interpreter first-tokens eligible for attachment (rules data field). */
  interpreters: readonly string[]
}

/**
 * The in-limit script text behind the unit, or undefined when no interpreter
 * segment resolves to an attachable file. Unresolvable segments (missing
 * file, variable path, over-limit, binary) are skipped in favor of the next
 * one — "only the first PARSEABLE script attaches". Any location qualifies —
 * attached content can only make the re-review more accurate.
 */
export async function readReviewableScript(lookup: ScriptLookup): Promise<string | undefined> {
  for (const segment of splitShellCommand(normalizeCommand(lookup.unit))) {
    const tokens = segmentTokens(segment)
    if (tokens.length < 2 || !lookup.interpreters.includes(tokens[0]!.toLowerCase())) continue
    const content = await readScriptFile(tokens, lookup)
    if (content !== undefined) return content
  }
  return undefined
}

/** Candidate → limits-checked file text for one interpreter segment; undefined when it does not resolve. */
async function readScriptFile(tokens: string[], lookup: ScriptLookup): Promise<string | undefined> {
  let candidate: string | undefined
  let positionalOnly = false
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!positionalOnly) {
      if (token === '--') {
        positionalOnly = true
        continue
      }
      if (token.startsWith('-')) continue
    }
    candidate = token
    break
  }
  if (!candidate) return undefined
  // Variable paths cannot be expanded here; attaching a wrong file is worse
  // than attaching none.
  if (candidate.includes('$') || candidate.includes('%')) return undefined

  const expanded = expandHome(candidate)
  const absolute = isAbsolute(expanded) ? expanded : resolve(scriptBaseOf(lookup), expanded)

  let info
  try {
    info = await stat(absolute)
  } catch {
    return undefined
  }
  if (!info.isFile() || info.size > MAX_BYTES) return undefined

  let content: string
  try {
    content = await readFile(absolute, 'utf8')
  } catch {
    return undefined
  }
  if (content.includes('\u0000')) return undefined
  if (!content.trim()) return undefined

  let nonPrintable = 0
  for (const ch of content) {
    const code = ch.charCodeAt(0)
    if (code < 32 && ch !== '\t' && ch !== '\n' && ch !== '\r') nonPrintable++
    else if (code === 0x7f) nonPrintable++
  }
  if (nonPrintable / content.length > MAX_BINARY_RATIO) return undefined

  const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
  if (lines > MAX_LINES) return undefined
  return content
}

/** Resolution base: the workspace root, advanced by the whole command's leading `cd`/`pushd` segments. */
function scriptBaseOf(lookup: ScriptLookup): string {
  let base = lookup.workspace ?? process.cwd()
  for (const segment of splitShellCommand(normalizeCommand(lookup.wholeCommand))) {
    const tokens = segmentTokens(segment)
    const word = (tokens[0] ?? '').toLowerCase()
    if ((word !== 'cd' && word !== 'pushd') || tokens.length < 2) break
    const target = expandHome(tokens[1]!)
    base = isAbsolute(target) ? target : resolve(base, target)
  }
  return base
}
