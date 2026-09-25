// SPEC 0021 ticket 01 — dump the five message catalogs and compute the
// verbatim-duplicate matrix. Throwaway tool; not part of the build.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const files = {
  core: 'packages/core/src/messages.ts',
  runtime: 'packages/host-runtime/src/messages.ts',
  pi: 'packages/host-pi/src/messages.ts',
  dsh: 'packages/host-dsh/src/messages.ts',
  cli: 'packages/cli/src/shell-messages.ts',
}

function parseCatalog(src) {
  // Take the two object literals passed to defineCatalog( ... , ... ).
  const callStart = src.indexOf('defineCatalog(')
  if (callStart < 0) throw new Error('defineCatalog not found')
  let i = src.indexOf('(', callStart) + 1
  const blocks = []
  while (blocks.length < 2) {
    while (src[i] !== '{') i++
    let depth = 0
    const start = i
    for (;;) {
      const c = src[i]
      if (c === "'") {
        i++
        while (src[i] !== "'") {
          if (src[i] === '\\') i++
          i++
        }
      }
      if (c === '{') depth++
      if (c === '}') {
        depth--
        if (depth === 0) break
      }
      i++
    }
    blocks.push(src.slice(start, i + 1))
    i++
  }
  const parseBlock = (block) => {
    const entries = {}
    const re = /(?:^|[,{]\s*)([A-Za-z_]\w*)\s*:\s*((?:'[^'\\]*(?:\\.[^'\\]*)*')|`[^`]*`)/g
    let m
    while ((m = re.exec(block))) {
      let raw = m[2]
      if (raw.startsWith('`')) raw = raw.slice(1, -1)
      else raw = raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
      entries[m[1]] = raw
    }
    return entries
  }
  return { zh: parseBlock(blocks[0]), en: parseBlock(blocks[1]) }
}

const catalogs = {}
for (const [name, rel] of Object.entries(files)) {
  const { zh, en } = parseCatalog(readFileSync(join(root, rel), 'utf8'))
  const zhKeys = Object.keys(zh)
  const enKeys = Object.keys(en)
  if (zhKeys.length !== enKeys.length) console.error(`!! ${name}: zh ${zhKeys.length} vs en ${enKeys.length} keys`)
  for (const k of zhKeys) if (!(k in en)) console.error(`!! ${name}: key ${k} missing in en`)
  catalogs[name] = { zh, en, keys: new Set(zhKeys) }
}

const names = Object.keys(catalogs)
// Cross-catalog identical-name keys and whether their zh+en values agree.
const byKey = {}
for (const name of names) for (const k of catalogs[name].keys) (byKey[k] ??= []).push(name)

const lines = []
const dupGroups = []
for (const [key, owners] of Object.entries(byKey)) {
  if (owners.length < 2) continue
  const same = owners.every((o) => catalogs[o].zh[key] === catalogs[o === 'core' ? owners.find((x) => x !== 'core') ?? o : owners[0]].zh[key] && catalogs[o].en[key] === catalogs[o === 'core' ? owners.find((x) => x !== 'core') ?? o : owners[0]].en[key])
  const ref = owners[0]
  const allSame = owners.every((o) => catalogs[o].zh[key] === catalogs[ref].zh[key] && catalogs[o].en[key] === catalogs[ref].en[key])
  dupGroups.push({ key, owners, allSame })
}

dupGroups.sort((a, b) => a.key.localeCompare(b.key))
for (const { key, owners, allSame } of dupGroups) {
  lines.push(`\n## ${key}  [${owners.join(', ')}]  ${allSame ? 'VERBATIM-IDENTICAL' : 'DRIFT'}`)
  for (const o of owners) {
    lines.push(`  ${o}.zh: ${JSON.stringify(catalogs[o].zh[key])}`)
    lines.push(`  ${o}.en: ${JSON.stringify(catalogs[o].en[key])}`)
  }
}

// Also: full key list per catalog for the boundary doc.
for (const name of names) {
  lines.push(`\n# ALL KEYS — ${name} (${catalogs[name].keys.size})`)
  lines.push([...catalogs[name].keys].sort().join('\n'))
}

// Verify specific near-dupe pairs the audit cares about (same family, diff keys).
const checks = [
  ['core rollbackDone', 'core', 'rollbackDone'],
  ['runtime rollbackDone', 'runtime', 'rollbackDone'],
  ['pi optimizeRollbackDone', 'pi', 'optimizeRollbackDone'],
  ['dsh rollbackDone', 'dsh', 'rollbackDone'],
  ['core analyzeDone', 'core', 'analyzeDone'],
  ['pi learnedAnalyzed', 'pi', 'learnedAnalyzed'],
  ['dsh analyzeDone', 'dsh', 'analyzeDone'],
  ['core rollbackNoBackup', 'core', 'rollbackNoBackup'],
  ['dsh rollbackNone', 'dsh', 'rollbackNone'],
]
lines.push('\n# NEAR-DUPE RECEIPTS')
for (const [label, cat, key] of checks) {
  const c = catalogs[cat]
  if (c.keys.has(key)) {
    lines.push(`${label}: zh=${JSON.stringify(c.zh[key])} en=${JSON.stringify(c.en[key])}`)
  } else lines.push(`${label}: (absent)`)
}

writeFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/audit-dump.txt'), lines.join('\n') + '\n')
console.log('written', lines.length, 'lines')
