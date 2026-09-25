// SPEC 0021 ticket 02 — splice the generated catalog block into
// packages/core/src/guard-messages.ts (replaces the two empty dict literals),
// and regenerate the CANONICAL_KEYS pin in the snapshot test from the same
// generated key order. Deterministic; no hand transcription.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const gen = readFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-catalog.txt'), 'utf8')

// gen-catalog.txt = header comment + import + the two dict literals.
const zhStart = gen.indexOf('const zhGuardSurface = {')
const enEnd = gen.indexOf('}', gen.indexOf('const enGuardSurface')) + 1
if (zhStart < 0 || enEnd <= zhStart) throw new Error('generated block not found')
const block = gen.slice(zhStart, enEnd)

const target = join(root, 'packages/core/src/guard-messages.ts')
let src = readFileSync(target, 'utf8')
const zhOpen = src.indexOf('const zhGuardSurface = {')
const closeEn = src.indexOf('const enGuardSurface')
const blockEnd = src.indexOf('\n}', closeEn) + 2
if (zhOpen < 0 || blockEnd <= zhOpen) throw new Error('skeleton dict block not found')
src = src.slice(0, zhOpen) + block + src.slice(blockEnd)
writeFileSync(target, src)

// Snapshot test: CANONICAL_KEYS from the generated order (sorted, as pinned).
const keys = readFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-keys.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .sort()
const testPath = join(root, 'packages/core/tests/guard-messages.spec.ts')
let test = readFileSync(testPath, 'utf8')
const pinStart = test.indexOf('const CANONICAL_KEYS: readonly string[] = [')
if (pinStart < 0) throw new Error('CANONICAL_KEYS pin not found')
const pinEnd = test.indexOf(']', pinStart) + 1
test = test.slice(0, pinStart) + 'const CANONICAL_KEYS: readonly string[] = [\n' + keys.map((k) => `  '${k}',`).join('\n') + '\n]' + test.slice(pinEnd)
writeFileSync(testPath, test)
console.log('spliced catalog (' + keys.length + ' keys) + snapshot pin')
