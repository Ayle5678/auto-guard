// SPEC 0021 ticket 03 — the guard-surface override channel for pi/dsh,
// mirroring the hook-host descriptor slot (ADR-0016): a factory taking
// guard-surface wording overrides as data + a no-override default lookup.
// Structural anchors only: head (through the core import line) is preserved
// with one rewritten import; the lookup tail is rebuilt from fresh bytes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'

// ---- 1) core: shared override slot type ----
{
  const p = join(root, 'packages/core/src/guard-messages.ts')
  const src = readFileSync(p, 'utf8')
  if (src.includes('GuardMessageOverrides')) throw new Error('core slot type already present')
  const anchorIdx = src.indexOf('/** Runtime key test')
  if (anchorIdx < 0) throw new Error('core anchor missing')
  const slot = [
    '/**',
    ' * Host-flavored guard-surface wording, as data — the pi/dsh counterpart of',
    ' * the hook-host `HostDescriptor.catalogOverride` slot (ADR-0016). Wording',
    ' * differences ride this channel; keys are never re-defined (ADR-0023).',
    ' */',
    'export type GuardMessageOverrides = { readonly [K in GuardMessageKey]?: Partial<Record<Lang, string>> }',
    '',
    '',
  ].join('\n')
  writeFileSync(p, src.slice(0, anchorIdx) + slot + src.slice(anchorIdx))
  console.log('core: GuardMessageOverrides slot type added')
}

// ---- 2) pi/dsh: factory + default lookup ----
const NEW_IMPORT =
  "import { defineCatalog, guardMessage, interpolate, isGuardMessageKey, type GuardMessageKey, type GuardMessageOverrides, type Lang } from '@auto-guard/core'"

const rebuildTail = (pkg, hostLabel, msgType, keyType, factoryName, defaultName) => {
  const p = join(root, pkg)
  const src = readFileSync(p, 'utf8')
  const marker = src.indexOf('/** Look up one ')
  if (marker < 0) throw new Error(`${pkg}: tail marker missing`)
  const head = src.slice(0, marker)
  if (!/^import \{[^}]*\} from '@auto-guard\/core'$/m.test(head)) throw new Error(`${pkg}: core import not found`)
  const newHead = head.replace(/^import \{[^}]*\} from '@auto-guard\/core'$/m, NEW_IMPORT)
  const tail = [
    `/** Build the ${hostLabel} lookup: guard-surface wording rides data overrides (the ADR-0016 slot, ADR-0023). */`,
    `export function ${factoryName}(overrides?: GuardMessageOverrides): ${msgType} {`,
    '  return (lang, key, params = {}) => {',
    '    if (isGuardMessageKey(key)) {',
    '      const override = overrides?.[key]?.[lang]',
    '      if (override !== undefined) return interpolate(override, params)',
    '      return guardMessage(lang, key, params)',
    '    }',
    '    return catalog.message(lang, key, params)',
    '  }',
    '}',
    '',
    '/** One bound host-surface message lookup: overrides first, then the shared catalog, then this catalog. */',
    `export type ${msgType} = (lang: Lang, key: ${keyType}, params?: Record<string, string | number>) => string`,
    '',
    `/** Default ${hostLabel} lookup (no overrides). */`,
    `export const ${defaultName}: ${msgType} = ${factoryName}()`,
    '',
  ].join('\n')
  writeFileSync(p, newHead + tail)
  console.log(`${pkg}: factory + default lookup installed`)
}

rebuildTail('packages/host-pi/src/messages.ts', 'Pi', 'PiMessage', 'PiMessageKey', 'createPiMessage', 'piMessage')
rebuildTail('packages/host-dsh/src/messages.ts', 'DSH', 'DshMessage', 'DshMessageKey', 'createDshMessage', 'dshMessage')
console.log('override channels wired')
