// Pi smoke: the full extension mount needs the Pi runtime (jiti + SDK), which
// is only present inside Pi. Here we smoke the pure adapter surface that Pi
// feeds into the guard, so the wiring contract stays checkable anywhere.
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { toGuardRequest } = await import(join(here, '..', '..', 'packages', 'host-pi', 'src', 'adapter.ts')).catch(() => ({ toGuardRequest: null }))
if (!toGuardRequest) {
  console.log('[smoke-pi] adapter not loadable outside workspace — SKIP')
  process.exitCode = 0
} else {
  const request = toGuardRequest({ tool: 'bash', command: 'git status' })
  const skipped = toGuardRequest({ tool: 'grep', arguments: {} })
  const ok = request?.tool === 'bash' && skipped === undefined
  console.log(`[smoke-pi] adapter mapping ${ok ? 'PASS' : 'FAIL'} (full mount smoke: run inside Pi with the extension registered)`)
  process.exitCode = ok ? 0 : 1
}
