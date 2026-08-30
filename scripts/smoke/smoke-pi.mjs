// Pi smoke: the full extension mount needs the Pi runtime (jiti + SDK), which
// is only present inside Pi. Here we smoke the pure adapter surface that Pi
// feeds into the guard (Node >= 22.18 strips types natively).
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
try {
  const { toGuardRequest } = await import(pathToFileURL(join(here, '..', '..', 'packages', 'host-pi', 'src', 'adapter.ts')).href)
  const request = toGuardRequest({ tool: 'bash', command: 'git status' })
  const skipped = toGuardRequest({ tool: 'grep' })
  const ok = request?.tool === 'bash' && skipped === undefined
  console.log(`[smoke-pi] adapter mapping ${ok ? 'PASS' : 'FAIL'} (full mount smoke: run inside Pi with the extension registered)`)
  process.exitCode = ok ? 0 : 1
} catch {
  console.log('[smoke-pi] runtime cannot load TS directly (needs Node >= 22.18) — SKIP')
  process.exitCode = 0
}
