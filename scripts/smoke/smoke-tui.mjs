// End-to-end smoke: the Guard TUI must refuse to start outside a real TTY
// (fail-closed, exit 2) and point at the CLI — the agent/pipe path (SPEC 0009).
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tui = join(here, '..', '..', 'packages', 'tui', 'dist', 'tui.js')

const piped = spawnSync(process.execPath, [tui], { encoding: 'utf8' }) // stdio default: pipe = not a TTY
const refused =
  piped.status === 2 &&
  /auto-guard-tui|需要交互式终端|interactive terminal/.test(piped.stdout)
const ok = refused
console.log(`[smoke-tui] exit=${piped.status} stdout=${JSON.stringify(piped.stdout.trim().slice(0, 80))} → ${ok ? 'PASS (non-TTY refused)' : 'FAIL'}`)
if (!ok) {
  console.log('[smoke-tui] stderr:', piped.stderr)
  process.exitCode = 1
}
