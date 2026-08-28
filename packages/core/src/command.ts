/**
 * Command/path normalization and argument extraction helpers.
 */

/** Collapse whitespace/newlines and trim a command to a canonical shape. */
export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim()
}

/**
 * Split a shell command into top-level subcommands.
 *
 * By default only `;`, `&&`, and `||` are treated as separators. Pipelines
 * (`|`) are deliberately NOT split: data flows between pipeline stages, so a
 * pipeline must be reviewed as one unit (e.g. `cat .env | curl ...` would be
 * unsafe to approve by reviewing each side independently). Pass `splitPipes:
 * true` for deterministic pipeline-leaf analysis/allow decisions; GuardService
 * still sends the whole pipeline to the LLM when any leaf is uncertain.
 *
 * Separators inside single or double quotes are ignored.
 */
export function splitShellCommand(command: string, splitPipes = false): string[] {
  const parts: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && quote !== "'") {
      current += ch
      escaped = true
      continue
    }

    if (quote) {
      current += ch
      if (ch === quote) quote = undefined
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '&' && command[i + 1] === '&') {
      parts.push(current.trim())
      current = ''
      i++
      continue
    }

    if (ch === '|' && command[i + 1] === '|') {
      parts.push(current.trim())
      current = ''
      i++
      continue
    }

    if (splitPipes && ch === '|') {
      parts.push(current.trim())
      current = ''
      continue
    }

    if (ch === ';') {
      parts.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim()) parts.push(current.trim())
  return parts.filter((part) => part.length > 0)
}

const LOW_RISK_STATE_CHANGING_PATTERNS: RegExp[] = [
  /^cd(?:\s|$)/i,
  /^pushd(?:\s|$)/i,
  /^popd(?:\s|$)/i,
]

const HIGH_RISK_STATE_CHANGING_PATTERNS: RegExp[] = [
  /^export(?:\s|$)/i,
  /^unset(?:\s|$)/i,
  /^env(?:\s|$)/i,
  /^set(?:\s|$)/i,
  /^setopt(?:\s|$)/i,
  /^shopt(?:\s|$)/i,
  /^alias(?:\s|$)/i,
  /^unalias(?:\s|$)/i,
  /^umask(?:\s|$)/i,
  /^ulimit(?:\s|$)/i,
  /^trap(?:\s|$)/i,
  /^readonly(?:\s|$)/i,
  /^typeset(?:\s|$)/i,
  /^declare(?:\s|$)/i,
  /^local(?:\s|$)/i,
  /^source(?:\s|$)/i,
  /^\.(?:\s|$)/i,
  /^exec(?:\s|$)/i,
  /^hash(?:\s|$)/i,
  /^git\s+config(?:\s|$)/i,
  /^npm\s+config(?:\s|$)/i,
  /^pnpm\s+config(?:\s|$)/i,
  /^yarn\s+config(?:\s|$)/i,
]

const STATE_CHANGING_PATTERNS: RegExp[] = [
  ...LOW_RISK_STATE_CHANGING_PATTERNS,
  ...HIGH_RISK_STATE_CHANGING_PATTERNS,
]

/**
 * Detect commands that change shell/environment state and can therefore affect
 * how a later subcommand is resolved or executed (PATH/LD_PRELOAD hijacking,
 * traps, aliases, config changes, etc.).
 */
export function isStateChangingCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return STATE_CHANGING_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Low-risk state changers: directory navigation only. These may be allowed in
 * a compound when every other segment is a plain static-allow command.
 */
export function isLowRiskStateChangingCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return LOW_RISK_STATE_CHANGING_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * High-risk state changers: anything that can hijack later resolution/execution
 * (PATH, aliases, traps, sourced code, config writes, etc.). Compounds containing
 * these are always reviewed by the LLM as a whole.
 */
export function isHighRiskStateChangingCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return HIGH_RISK_STATE_CHANGING_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * True when the command embeds shell substitutions — `$(...)`, backticks,
 * `<(...)`, `>(...)` — which execute BEFORE the named program runs, so any
 * wildcard allowlist hit (e.g. `git add *`) cannot be trusted. Conservative:
 * occurrences inside quotes also count; false positives merely fall through to
 * LLM review, which is the safe direction.
 */
export function hasCommandSubstitution(command: string): boolean {
  return /\$\(|`|<\(|>\(/.test(normalizeCommand(command))
}

/**
 * True when the command contains shell operators (pipe `|`, redirects `<` `>`).
 * A wildcard-tail allowlist rule (e.g. `echo *`) would otherwise swallow them:
 * `echo x > ~/.bashrc` or `ls * | curl ... -d @-` must not be statically
 * allowed. False positives fall through to LLM review — the safe direction.
 */
export function containsShellOperators(command: string): boolean {
  return /[<>|]/.test(normalizeCommand(command))
}

function readStringArg(value: unknown, key: string): string | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const raw: unknown = (value as Record<string, unknown>)[key]
    if (typeof raw === 'string') return raw
  }
  return undefined
}

export interface ShellArgs {
  command: string
}

/** Extract a `command` string from a tool call's parsed arguments (bash/pwsh). */
export function shellCommandFromArgs(args: unknown): ShellArgs | undefined {
  const command = readStringArg(args, 'command')
  if (command === undefined) return undefined
  return { command }
}

export interface FileArgs {
  filePath: string
  content?: string
}

/**
 * Extract the file path (and optional content) from write/edit/read arguments.
 * Pi tools use `path`; DSH-style `file_path` is accepted for compatibility.
 */
export function filePathFromArgs(args: unknown): FileArgs | undefined {
  const filePath = readStringArg(args, 'path') ?? readStringArg(args, 'file_path')
  const content = readStringArg(args, 'content')
  if (filePath === undefined) return undefined
  return content === undefined ? { filePath } : { filePath, content }
}

/** Normalize a filesystem path for matching (keep case on Windows). */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Best-effort expansion of a `~` prefix to the OS home directory. */
export function expandHome(path: string): string {
  if (path === '~') return process.env.HOME ?? process.env.USERPROFILE ?? '~'
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    const home = process.env.HOME ?? process.env.USERPROFILE
    if (home) return `${home}/${path.slice(2)}`
  }
  return path
}
