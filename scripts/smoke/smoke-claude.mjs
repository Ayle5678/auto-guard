// End-to-end smoke: run the built Claude Code PreToolUse hook against sample
// payloads inside an isolated HOME. Expects: allow-listed Bash → empty stdout
// (silence is pass), hard-deny Bash → PreToolUse JSON with permissionDecision
// "deny", both with exit code 0 (decisions never travel via exit code 2).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hookCli = join(here, '..', '..', 'packages', 'host-claude', 'dist', 'hook-cli.js')
const home = mkdtempSync(join(tmpdir(), 'ag-smoke-cl-'))
const configDir = join(home, '.claude', 'auto-guard')
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

const notebook = run({
  session_id: 'smoke-session',
  hook_event_name: 'PreToolUse',
  tool_name: 'NotebookEdit',
  tool_input: { notebook_path: 'C:/x/ipynb', new_source: 'print(1)' },
})
let notebookOk = notebook.status === 0
if (notebookOk && notebook.stdout.trim() !== '') {
  // Any guarded NotebookEdit outcome must be valid PreToolUse JSON, never garbage.
  const parsed = JSON.parse(notebook.stdout)
  notebookOk = parsed.hookSpecificOutput?.hookEventName === 'PreToolUse'
}

console.log(`[smoke-claude] allow: exit=${allow.status} stdout=${JSON.stringify(allow.stdout.trim())} → ${allowOk ? 'PASS' : 'FAIL'}`)
console.log(`[smoke-claude] deny : exit=${deny.status} decision=${deny.stdout.includes('"deny"') ? 'deny' : '?'} → ${denyOk ? 'PASS' : 'FAIL'}`)
console.log(`[smoke-claude] notebook: exit=${notebook.status} → ${notebookOk ? 'PASS' : 'FAIL'}`)
if (!allowOk || !denyOk || !notebookOk) {
  console.log('[smoke-claude] stderr:', allow.stderr || deny.stderr || notebook.stderr)
}
rmSync(home, { recursive: true, force: true })
process.exitCode = allowOk && denyOk && notebookOk ? 0 : 1
