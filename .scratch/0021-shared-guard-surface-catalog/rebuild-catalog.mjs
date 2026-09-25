// SPEC 0021 ticket 02 — rebuild packages/core/src/guard-messages.ts from the
// generated catalog block. Fixes the naive splice that truncated the en dict
// at the first `}` inside a `{param}` placeholder: dict literals are now
// extracted with quote-aware brace matching. The trailing skeleton (key type,
// lookups, key list, guard) is static and re-emitted verbatim.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const gen = readFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-catalog.txt'), 'utf8')

/** Extract one `{ ... }` dict literal starting at `open` (index of `{`), honoring single-quoted strings. */
const dictEnd = (src, open) => {
  let i = open
  let depth = 0
  for (;;) {
    const c = src[i]
    if (c === "'") {
      i++
      while (src[i] !== "'") {
        if (src[i] === '\\') i++
        i++
      }
    } else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
}

const zhMark = 'const zhGuardSurface = {'
const zhOpen = gen.indexOf(zhMark) + zhMark.length - 1
const zhClose = dictEnd(gen, zhOpen)
const enMark = gen.indexOf('const enGuardSurface')
const enOpen = gen.indexOf('{', enMark)
const enClose = dictEnd(gen, enOpen)
const zhDict = gen.slice(zhOpen, zhClose + 1)
const enDict = gen.slice(enOpen, enClose + 1)

const keyCount = (dict) => [...dict.matchAll(/^ {4}[A-Za-z_]\w*:/gm)].length
if (keyCount(zhDict) !== keyCount(enDict)) throw new Error(`dict key mismatch: zh ${keyCount(zhDict)} vs en ${keyCount(enDict)}`)

const header = [
  '/**',
  ' * Shared guard-surface message catalog (zh / en) — the user-visible wording',
  ' * of the guard surface itself (receipts, usage, the deletion flow, key and',
  ' * audit management), hosted in core beside `defineCatalog` so every host',
  ' * resolves it through one definition (ADR-0023). Host chrome — dialogs,',
  ' * settings pages, installer, TUI — stays in the host packages; host-flavored',
  ' * wording rides `HostDescriptor.catalogOverride` (ADR-0016). Key parity',
  ' * between languages is enforced by the type system. Values are byte-exact',
  ' * migrations of the host wording (SPEC 0021 ticket 02); the usage lines take',
  ' * the driver program name (ADR-0022).',
  ' */',
  "import { defineCatalog, type Lang } from './lang.ts'",
  '',
].join('\n')

const tail = [
  '',
  '/** One shared guard-surface message key. */',
  'export type GuardMessageKey = keyof typeof zhGuardSurface',
  '',
  '/** Look up one shared guard-surface message. */',
  'export function guardMessage(lang: Lang, key: GuardMessageKey, params: Record<string, string | number> = {}): string {',
  '  return catalog.message(lang, key, params)',
  '}',
  '',
  '/** All shared guard-surface keys (the anti-drift set for host catalogs). */',
  'export const guardMessageKeys = Object.keys(zhGuardSurface) as GuardMessageKey[]',
  '',
  '/** Runtime key test: does this string name a shared guard-surface key? */',
  'export function isGuardMessageKey(key: string): key is GuardMessageKey {',
  '  return key in zhGuardSurface',
  '}',
  '',
].join('\n')

const out = `${header}\nconst catalog = defineCatalog(zhGuardSurface, enGuardSurface)\n\nconst zhGuardSurface = {\n` // placeholder, replaced below
const file =
  header +
  '\nconst zhGuardSurface = ' +
  zhDict.trim().replace(/^/, '') +
  '\n\nconst enGuardSurface: Record<keyof typeof zhGuardSurface, string> = ' +
  enDict.trim() +
  '\n\nconst catalog = defineCatalog(zhGuardSurface, enGuardSurface)\n' +
  tail

writeFileSync(join(root, 'packages/core/src/guard-messages.ts'), file)
console.log(`rebuilt guard-messages.ts: ${keyCount(zhDict)} keys`)
