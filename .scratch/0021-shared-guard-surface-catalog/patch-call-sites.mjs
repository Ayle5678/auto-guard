// SPEC 0021 ticket 02 — receipt-dedupe call-site rewrites (pi + dsh) and the
// dsh context-label dedupe onto core kind* keys. Capture-based: unchanged
// lines are re-emitted byte-exact from the matched source; every pattern must
// match exactly once or the script aborts without writing.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'

const patchOnce = (rel, re, build) => {
  const path = join(root, rel)
  const src = readFileSync(path, 'utf8')
  const matches = [...src.matchAll(re)]
  if (matches.length !== 1) throw new Error(`${rel}: pattern matched ${matches.length}x (expected 1)`)
  writeFileSync(path, src.replace(re, build(matches[0])))
  console.log(`${rel}: patched`)
}

const PI = 'packages/host-pi/src/index.ts'
const DSH = 'packages/host-dsh/src/index.ts'
const DSH_POLICY = 'packages/host-dsh/src/notify-policy.ts'

// ---------- pi ----------
// import swap: restore -> rollback (in place, keeps list order)
patchOnce(PI, /^  restoreLearnedRules,\n/mg, () => '  rollbackLearnedRules,\n')

// learned-analysis success receipt -> the core receipt (result.message)
patchOnce(PI, /^([ ]+)([\w.$]+\.notify)\(piMessage\(guard\.lang, 'learnedAnaly[sz]ed'[^)]*\), 'info'\)\n/mg,
  (m) => `${m[1]}${m[2]}(result.message, 'info')\n`)

// dead empty-list fallback (the rendered list always carries its header line)
patchOnce(PI, /^([ ]+)([\w.$]+\.notify)\(([\w.$]+)\.join\('\\n'\) \|\| t\('optimizeList[A-Za-z]*'\), 'info'\)\n/mg,
  (m) => `${m[1]}${m[2]}(${m[3]}.join('\\n'), 'info')\n`)

// rollback: restore + self-rendered receipts -> core rollbackLearnedRules receipt
patchOnce(
  PI,
  /^[ ]+if \(restoreLearnedRules\(guard\.config\.learnedRulesPath, guard\.config\.learnedBackupPath\)\) \{\n([ ]+)([ ]+[\w.$]+ = loadLearnedRules\([^\n]*\)\n)([ ]+[\w.$]+\.[\w.$]+\([\w.$]+\)\n)([ ]+)([\w.$]+\.notify)\(t\('optimizeRollback[A-Za-z]*'\), 'info'\)\n[ ]+\} else \{\n([ ]+)([\w.$]+\.notify)\(t\('optimizeRollback[A-Za-z]*'\), 'warning'\)\n/mg,
  (m) =>
    `${m[1]}const result = rollbackLearnedRules(guard.config, guard.lang)\n` +
    `${m[1]}if (result.ok) {\n` +
    `${m[2]}` +
    `${m[3]}` +
    `${m[4]}${m[5]}(result.message, 'info')\n` +
    `${m[4]}} else {\n` +
    `${m[6]}${m[7]}(result.message, 'warning')\n` +
    `${m[4]}}\n`,
)

// history toggle receipt -> core result.messages
patchOnce(PI, /^([ ]+const result = applyHistoryToggle\(guard\.config, raw === 'history on' \? 'on' : 'off', guard\.lang\)\n[ ]+if \(result\.ok\) saveConfig\(guard\.config\)\n[ ]+)([\w.$]+\.notify)\(t\(guard\.config\.historyEnabled \? 'optimizeHistory[A-Za-z]*' : 'optimizeHistory[A-Za-z]*'\), 'info'\)\n/mg,
  (m) => `${m[1]}${m[2]}(result.messages.join('\\n'), 'info')\n`)

// ---------- dsh ----------
patchOnce(DSH, /^  restoreLearnedRules,\n/mg, () => '  rollbackLearnedRules,\n')

patchOnce(
  DSH,
  /^[ ]+if \(!restoreLearnedRules\(state\.config\.learnedRulesPath, state\.config\.learnedBackupPath\)\) \{\n[ ]+return \{ ok: false, message: t\('rollbackNone'\) \}\n[ ]+\}\n([ ]+)([ ]+[\w.$]+ = loadLearnedRules\([^\n]*\)\n)([ ]+[\w.$]+\.[\w.$]+\([\w.$]+\)\n)[ ]+return \{ ok: true, message: t\('rollbackDone'\) \}\n/mg,
  (m) =>
    '      const result = rollbackLearnedRules(state.config, state.lang)\n' +
    '      if (!result.ok) return result\n' +
    `${m[1]}${m[2]}` +
    `${m[3]}` +
    '      return result\n',
)

// context-route labels -> core kind* keys (byte-identical wording, ADR-0023)
patchOnce(DSH_POLICY, /^import \{ dshMessage \} from '\.\/messages\.ts'\n/mg,
  () => "import { coreMessage } from '@auto-guard/core'\nimport { dshMessage } from './messages.ts'\n")

patchOnce(DSH_POLICY, /^  return dshMessage\(lang, kind === 'allow' \? 'contextAllow' : kind === 'deny' \? 'contextDeny' : 'contextAsk'\)\n/mg,
  () => "  return coreMessage(lang, kind === 'allow' ? 'kindAllow' : kind === 'deny' ? 'kindDeny' : 'kindAsk')\n")

console.log('call sites patched')
