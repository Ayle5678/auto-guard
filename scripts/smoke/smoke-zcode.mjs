// End-to-end smoke: run the built ZCode PreToolUse hook against a fake
// allow-listed payload inside an isolated USERPROFILE. Expects empty stdout
// (allow = silent) and exit code 0.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hookCli = join(here, '..', '..', 'packages', 'host-zcode', 'dist', 'hook-cli.js')
const home = mkdtempSync(join(tmpdir(), 'ag-smoke-zc-'))
const configDir = join(home, '.zcode', 'auto-guard')
mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

const payload = JSON.stringify({
  session_id: 'smoke-session',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git status' },
})

const result = spawnSync(process.execPath, [hookCli], { input: payload, encoding: 'utf8', env: { ...process.env, USERPROFILE: home } })
const ok = result.status === 0 && result.stdout.trim() === ''
console.log(`[smoke-zcode] exit=${result.status} stdout=${JSON.stringify(result.stdout.trim())} → ${ok ? 'PASS (allow silent)' : 'FAIL'}`)
if (!ok) {
  console.log('[smoke-zcode] stderr:', result.stderr)
  console.log('[smoke-zcode] stdout raw:', JSON.stringify(result.stdout))
}
rmSync(home, { recursive: true, force: true })
process.exitCode = ok ? 0 : 1
