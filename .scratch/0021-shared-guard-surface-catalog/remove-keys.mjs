// SPEC 0021 ticket 02 — remove migrated guard-surface keys from the four
// host catalogs. The removal set is DERIVED: shared-catalog keys (read from
// the generated guard-messages.ts) intersect each host's own keys — nothing
// hand-typed. Strict: each key must match exactly two lines (zh + en) or the
// script aborts without writing.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const HOSTS = [
  'packages/host-runtime/src/messages.ts',
  'packages/host-pi/src/messages.ts',
  'packages/host-dsh/src/messages.ts',
  'packages/cli/src/shell-messages.ts',
]

const guardSrc = readFileSync(join(root, 'packages/core/src/guard-messages.ts'), 'utf8')
const zhBlock = guardSrc.slice(guardSrc.indexOf('const zhGuardSurface = {'), guardSrc.indexOf('const enGuardSurface'))
const guardKeys = [...zhBlock.matchAll(/^    ([A-Za-z_]\w*): /gm)].map((m) => m[1])
if (guardKeys.length < 40) throw new Error('shared catalog unexpectedly small: ' + guardKeys.length)

const hostKeys = (src) => {
  const start = src.indexOf('defineCatalog(')
  const end = src.indexOf(')\n', start)
  return new Set([...src.slice(start, end).matchAll(/^    ([A-Za-z_]\w*): /gm)].map((m) => m[1]))
}

for (const rel of HOSTS) {
  const path = join(root, rel)
  const src = readFileSync(path, 'utf8')
  const own = hostKeys(src)
  const remove = guardKeys.filter((k) => own.has(k))
  const lines = src.split('\n')
  for (const key of remove) {
    const re = new RegExp(`^    ${key}: '(?:[^'\\\\]|\\\\.)*',?$`)
    const hits = []
    lines.forEach((l, i) => { if (re.test(l)) hits.push(i) })
    if (hits.length !== 2) throw new Error(`${rel}: ${key} matched ${hits.length} lines (expected 2)`)
    for (const i of hits.reverse()) lines.splice(i, 1)
  }
  writeFileSync(path, lines.join('\n'))
  console.log(`${rel}: removed ${remove.length} keys → ${remove.join(', ')}`)
}
