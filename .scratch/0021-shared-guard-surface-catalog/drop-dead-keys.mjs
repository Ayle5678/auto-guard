// SPEC 0021 — drop the now-dead host receipt keys whose call sites render the
// core receipts instead (ticket 02 reroutes). Each key must match exactly two
// definition lines (zh + en block) or the script aborts.
import { readFileSync, writeFileSync } from 'node:fs'

const PI = 'D:/yilun/yilun_project/auto-guard/packages/host-pi/src/messages.ts'
const DSH = 'D:/yilun/yilun_project/auto-guard/packages/host-dsh/src/messages.ts'

const drop = (path, keys) => {
  const out = []
  let removed = 0
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const hit = keys.some((k) => new RegExp(`^    ${k}: '(?:[^'\\\\]|\\\\.)*',?$`).test(line))
    if (hit) removed++
    else out.push(line)
  }
  if (removed !== keys.length * 2) throw new Error(`${path}: removed ${removed} lines, expected ${keys.length * 2}`)
  writeFileSync(path, out.join('\n'))
  console.log(`${path}: dropped ${removed} dead lines`)
}

drop(PI, ['learnedAnalyzed', 'optimizeRollbackDone', 'optimizeRollbackNone', 'optimizeListEmpty', 'optimizeHistoryOn', 'optimizeHistoryOff'])
drop(DSH, ['contextAllow', 'contextDeny', 'contextAsk', 'rollbackDone', 'rollbackNone'])
