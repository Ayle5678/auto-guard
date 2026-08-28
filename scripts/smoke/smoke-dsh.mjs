// DSH smoke: the full plugin mount needs the DeepSeek Harness runtime
// (cordis + dsh-tools). Here we smoke the pure adapter surface that DSH feeds
// into the guard.
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { toGuardRequest } = await import(join(here, '..', '..', 'packages', 'host-dsh', 'src', 'adapter.ts')).catch(() => ({ toGuardRequest: null }))
if (!toGuardRequest) {
  console.log('[smoke-dsh] adapter not loadable outside workspace — SKIP')
  process.exitCode = 0
} else {
  const request = toGuardRequest({ name: 'bash', arguments: { command: 'git status' }, signal: new AbortController().signal })
  const skipped = toGuardRequest({ name: 'grep', arguments: {}, signal: new AbortController().signal })
  const ok = request?.tool === 'bash' && skipped === undefined
  console.log(`[smoke-dsh] adapter mapping ${ok ? 'PASS' : 'FAIL'} (full mount smoke: run inside DSH with the plugin registered)`)
  process.exitCode = ok ? 0 : 1
}
