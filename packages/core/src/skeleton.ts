/**
 * Token-level command skeleton.
 *
 * A skeleton keeps the command's structure (command names, flags, pipes,
 * redirects, separators) and replaces volatile arguments with typed
 * placeholders. It is used by the history layer and learned-rule generation so
 * similar-but-not-identical commands can be grouped without falling back to
 * whole-command `*` globs.
 */

export type SkeletonPlaceholder =
  | '<str>'
  | '<path>'
  | '<num>'
  | '<date>'
  | '<hash>'
  | '<url>'
  | '<var>'
  | '<val>'
  | '<arg>'

const OPERATOR_TOKENS = new Set(['|', '||', ';', '&&'])

/** Commands whose positional bare arguments are safe to treat as volatile. */
const VARIABLE_ARG_COMMANDS = new Set([
  'cat',
  'grep',
  'rg',
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
  'echo',
  'sed',
  'awk',
  'jq',
  'yq',
])

/**
 * Quote-aware tokenizer. Splits on whitespace and shell separators outside
 * quotes; keeps `&&`, `||`, `;`, `|` as distinct tokens. Redirect fragments
 * such as `2>&1` are kept as one token.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined

  const push = () => {
    if (current) {
      tokens.push(current)
      current = ''
    }
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
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
    if (/\s/.test(ch)) {
      push()
      continue
    }
    if (ch === '|') {
      push()
      if (command[i + 1] === '|') {
        tokens.push('||')
        i++
      } else {
        tokens.push('|')
      }
      continue
    }
    if (ch === ';') {
      push()
      tokens.push(';')
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      push()
      tokens.push('&&')
      i++
      continue
    }
    current += ch
  }
  push()
  return tokens
}

function isQuoted(token: string): boolean {
  return (
    token.length >= 2 &&
    ((token[0] === '"' && token[token.length - 1] === '"') ||
      (token[0] === "'" && token[token.length - 1] === "'"))
  )
}

function isDate(token: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(token)
}

function isNumber(token: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(token)
}

function isHash(token: string): boolean {
  return /^[0-9a-f]{7,}$/i.test(token)
}

function isUrl(token: string): boolean {
  return /^https?:\/\//i.test(token)
}

function isShellVar(token: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(token)
}

function isPath(token: string): boolean {
  return (
    /^[~.]?\S*[\\/]\S*$/.test(token) ||
    /^~[^\\/\s]*$/.test(token) ||
    /^\.{1,2}$/.test(token) ||
    /^[^-\s][^\s]*\.[A-Za-z0-9_]{1,8}$/.test(token)
  )
}

function placeholderFor(token: string): SkeletonPlaceholder | undefined {
  if (isQuoted(token)) return '<str>'
  if (isUrl(token)) return '<url>'
  if (isShellVar(token)) return '<var>'
  if (isHash(token)) return '<hash>'
  if (isDate(token)) return '<date>'
  if (isNumber(token)) return '<num>'
  if (/^-{1,2}[A-Za-z0-9-]+=/.test(token)) return '<val>'
  if (isPath(token)) return '<path>'
  return undefined
}

/** Build a token-level skeleton for a command. */
export function skeletonOf(command: string): string {
  const tokens = tokenizeCommand(command)
  const parts: string[] = []
  let currentFirst: string | undefined
  let variableArgs = false
  for (const token of tokens) {
    if (OPERATOR_TOKENS.has(token)) {
      parts.push(token)
      currentFirst = undefined
      continue
    }
    const placeholder = placeholderFor(token)
    if (placeholder === '<val>') {
      const eq = token.indexOf('=')
      parts.push(`${token.slice(0, eq + 1)}<val>`)
      continue
    }
    if (placeholder) {
      parts.push(placeholder)
      continue
    }
    if (currentFirst === undefined) {
      currentFirst = token.toLowerCase()
      variableArgs = VARIABLE_ARG_COMMANDS.has(currentFirst)
      parts.push(token)
      continue
    }
    if (variableArgs && !token.startsWith('-')) {
      parts.push('<arg>')
      continue
    }
    parts.push(token)
  }
  return parts.join(' ')
}

/** True when a skeleton contains at least one typed placeholder. */
export function skeletonHasPlaceholder(skeleton: string): boolean {
  return /<[a-z]+>/.test(skeleton)
}

/** Count fixed (non-placeholder) tokens after the first token. */
export function fixedTokensAfterFirst(skeleton: string): number {
  const tokens = skeleton.split(/\s+/)
  return tokens.slice(1).filter((t) => !/^<[a-z]+>$/.test(t)).length
}
