// SPEC 0021 — re-apply the pi call-site patches from a clean HEAD state.
// Line-anchored only: unchanged lines are re-emitted byte-exact, receivers
// and identifiers are captured from the file, and every anchor must resolve
// to exactly one line or the script aborts without writing.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const rel = 'packages/host-pi/src/index.ts'
const path = join(root, rel)

// 0) restore the pristine file from HEAD (read-only git access, no checkout)
const pristine = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
let lines = pristine.split('\n')
console.log(`restored ${rel} from HEAD (${lines.length} lines)`)

const only = (re, label) => {
  const hits = []
  lines.forEach((l, i) => {
    if (re.test(l)) hits.push(i)
  })
  if (hits.length !== 1) throw new Error(`anchor "${label}" matched ${hits.length} lines (expected 1)`)
  return hits[0]
}

// 1) import swap: restoreLearnedRules -> rollbackLearnedRules (in place)
lines[only(/^  restoreLearnedRules,$/, 'import restoreLearnedRules')] = '  rollbackLearnedRules,'

// 2) learned-analysis success receipt -> the core receipt (result.message)
{
  const i = only(/'learnedAnaly[sz]ed'/, 'learned receipt')
  const m = lines[i].match(/^(\s*)([\w.$]+\.notify)\(/)
  if (!m) throw new Error('learned receipt line shape unexpected')
  lines[i] = `${m[1]}${m[2]}(result.message, 'info')`
}

// 3) dead empty-list fallback: the rendered list always carries its header
{
  const i = only(/\|\| t\('optimizeList[A-Za-z]*'/, 'dead list fallback')
  const m = lines[i].match(/^(\s*)([\w.$]+\.notify)\(([\w.$]+)\.join/)
  if (!m) throw new Error('dead fallback line shape unexpected')
  lines[i] = `${m[1]}${m[2]}(${m[3]}.join('\\n'), 'info')`
}

// 4) rollback block: rebuild with the core receipt; reuse the two state
//    update lines byte-exact (re-indented).
const start = only(/^\s*\} else if \(raw === 'rollback'\) \{$/, 'rollback else-if')
let end = -1
for (let i = start + 1; i < lines.length; i++) {
  if (/^\s*\} else if \(raw === 'history/.test(lines[i])) {
    end = i
    break
  }
}
if (end < 0) throw new Error('history else-if not found after rollback')
const inner = lines.slice(start + 1, end)
const loadLine = inner.find((l) => /loadLearnedRules\(/.test(l))
const cacheLine = inner.find((l) => /[Ss]etCacheab[a-z]*Patterns?\(/.test(l))
const recv = (inner.find((l) => /\.notify\(/.test(l)) ?? '').match(/([\w.$]+\.notify)/)?.[1]
if (!loadLine || !cacheLine || !recv) throw new Error('rollback inner lines/receiver not found')
lines.splice(
  start + 1,
  end - start - 1,
  '        const result = rollbackLearnedRules(guard.config, guard.lang)',
  '        if (result.ok) {',
  `          ${loadLine.replace(/^\s+/, '')}`,
  `          ${cacheLine.replace(/^\s+/, '')}`,
  `          ${recv}(result.message, 'info')`,
  '        } else {',
  `          ${recv}(result.message, 'warning')`,
  '        }',
)

// 5) history toggle receipt -> the core toggle receipts (result.messages)
{
  const i = only(/'optimizeHistory[A-Za-z]*'/, 'history receipt')
  const m = lines[i].match(/^(\s*)([\w.$]+\.notify)\(/)
  if (!m) throw new Error('history receipt line shape unexpected')
  lines[i] = `${m[1]}${m[2]}(result.messages.join('\\n'), 'info')`
}

writeFileSync(path, lines.join('\n'))
console.log('pi call sites re-patched (line-anchored)')
