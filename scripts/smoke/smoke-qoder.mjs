// End-to-end smoke: run the built Qoder PreToolUse hook against sample
// payloads inside an isolated HOME. Expects: allow-listed Bash → empty stdout
// (silence is pass), hard-deny Bash → PreToolUse JSON with permissionDecision
// "deny", the long internal tool name run_in_terminal → same deny decision
// (dual-naming translation), all with exit code 0 (decisions never travel via
// exit code 2).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hookCli = join(here, '..', '..', 'packages', 'host-qoder', 'dist', 'hook-cli.js')
const home = mkdtempSync(join(tmpdir(), 'ag-smoke-qd-'))
const configDir = join(home, '.qoder', 'auto-guard')
mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

const run = (payload) =>
  spawnSync(process.execPath, [hookCli], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } })

const allow = run({
  session_id: 'smoke-session',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git status' },
})
const allowOk = allow.status === 0 && allow.stdout.trim() === ''

const deny = run({
  session_id: 'smoke-session',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /' },
})
let denyOk = deny.status === 0
if (denyOk) {
  const parsed = JSON.parse(deny.stdout)
  denyOk = parsed.hookSpecificOutput?.hookEventName === 'PreToolUse' && parsed.hookSpecificOutput?.permissionDecision === 'deny'
}

const longName = run({
  session_id: 'smoke-session',
  hook_event_name: 'PreToolUse',
  tool_name: 'run_in_terminal',
  tool_input: { command: 'rm -rf /' },
})
let longNameOk = longName.status === 0
if (longNameOk && longName.stdout.trim() !== '') {
  const parsed = JSON.parse(longName.stdout)
  longNameOk = parsed.hookSpecificOutput?.hookEventName === 'PreToolUse' && parsed.hookSpecificOutput?.permissionDecision === 'deny'
}

console.log(`[smoke-qoder] allow: exit=${allow.status} stdout=${JSON.stringify(allow.stdout.trim())} → ${allowOk ? 'PASS' : 'FAIL'}`)
console.log(`[smoke-qoder] deny : exit=${deny.status} decision=${deny.stdout.includes('"deny"') ? 'deny' : '?'} → ${denyOk ? 'PASS' : 'FAIL'}`)
console.log(`[smoke-qoder] run_in_terminal: exit=${longName.status} decision=${longName.stdout.includes('"deny"') ? 'deny' : '?'} → ${longNameOk ? 'PASS' : 'FAIL'}`)
if (!allowOk || !denyOk || !longNameOk) {
  console.log('[smoke-qoder] stderr:', allow.stderr || deny.stderr || longName.stderr)
}
rmSync(home, { recursive: true, force: true })
process.exitCode = allowOk && denyOk && longNameOk ? 0 : 1
