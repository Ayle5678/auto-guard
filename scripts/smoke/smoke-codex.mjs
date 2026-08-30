// End-to-end smoke: run the built Codex PreToolUse hook against four payloads
// inside an isolated home (USERPROFILE + HOME both set — mac/Linux resolve ~
// via HOME). Codex wire (SPEC 0015): allow = empty stdout + exit 0; deny =
// hookSpecificOutput JSON with permissionDecision "deny" (asks land as deny
// because codex discards-and-continues on "ask").
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hookCli = join(here, '..', '..', 'packages', 'host-codex', 'dist', 'hook-cli.js')
const home = mkdtempSync(join(tmpdir(), 'ag-smoke-cx-'))
const configDir = join(home, '.codex', 'auto-guard')
mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

function run(payload) {
  return spawnSync(process.execPath, [hookCli], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } })
}

function decisionOf(stdout) {
  const parsed = JSON.parse(stdout)
  return parsed.hookSpecificOutput.permissionDecision
}

const results = []

// 1. static-allowed bash → silent allow
const allow = run({ session_id: 'smoke', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } })
results.push(['allow (git status silent)', allow.status === 0 && allow.stdout.trim() === '', allow])

// 2. hard-deny bash → deny JSON
const deny = run({ session_id: 'smoke', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })
results.push(['deny (rm -rf / blacklist)', deny.status === 0 && decisionOf(deny.stdout) === 'deny', deny])

// 3. patch touching a sensitive file on the SECOND path → deny (sensitive gate over all paths)
const sensitivePatch = ['*** Begin Patch', '*** Update File: src/app.ts', '@@ line', '*** Update File: .env', '+KEY=1', ''].join('\n')
const sensitive = run({ session_id: 'smoke', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: sensitivePatch } })
results.push(['deny (patch touches .env via ask→deny fallback)', sensitive.status === 0 && decisionOf(sensitive.stdout) === 'deny', sensitive])

// 4. benign patch → silent allow
const benignPatch = ['*** Begin Patch', '*** Update File: src/app.ts', '@@ line', '+ok()', ''].join('\n')
const patchAllow = run({ session_id: 'smoke', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: benignPatch } })
results.push(['allow (benign patch silent)', patchAllow.status === 0 && patchAllow.stdout.trim() === '', patchAllow])

rmSync(home, { recursive: true, force: true })

let ok = true
for (const [name, pass, result] of results) {
  console.log(`[smoke-codex] ${pass ? 'PASS' : 'FAIL'} — ${name}`)
  if (!pass) {
    ok = false
    console.log('[smoke-codex]   exit=', result.status, 'stdout=', JSON.stringify(result.stdout), 'stderr=', result.stderr)
  }
}
process.exitCode = ok ? 0 : 1
