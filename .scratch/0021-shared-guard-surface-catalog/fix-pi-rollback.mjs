// SPEC 0021 — repair the pi rollback block (previous splice left an extra
// closing brace and wobbling indentation). Anchor-based range replace keyed
// on the real bytes around the block; aborts unless exactly one match.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/yilun/yilun_project/auto-guard/packages/host-pi/src/index.ts'
const src = readFileSync(path, 'utf8')

const re = /      \} else if \(raw === 'rollback'\) \{\n[\s\S]*?\n      \} else if \(raw === 'history on'/g
const matches = [...src.matchAll(re)]
if (matches.length !== 1) throw new Error(`rollback block matched ${matches.length}x (expected 1)`)

const clean = [
  "      } else if (raw === 'rollback') {",
  '        const result = rollbackLearnedRules(guard.config, guard.lang)',
  '        if (result.ok) {',
  '          guard.learned = loadLearnedRules(guard.config.learnedRulesPath, [...guard.rules.hardDeny, ...guard.rules.alwaysReview, ...guard.rules.directoryDelete])',
  '          guard.templateCache.setCacheablePatterns(guard.learned.cacheable)',
  "          ctx.ui.notify(result.message, 'info')",
  '        } else {',
  "          ctx.ui.notify(result.message, 'warning')",
  '        }',
  "      } else if (raw === 'history on'",
].join('\n')

writeFileSync(path, src.replace(re, clean))
console.log('rollback block normalized')
