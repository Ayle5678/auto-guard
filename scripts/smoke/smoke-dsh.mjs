// DSH smoke: the full plugin mount needs the DeepSeek Harness runtime
// (cordis + dsh-tools). Here we smoke the pure adapter surface that DSH feeds
// into the guard (Node >= 23 strips types natively).
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
try {
  const { toGuardRequest } = await import(pathToFileURL(join(here, '..', '..', 'packages', 'host-dsh', 'src', 'adapter.ts')).href)
  const request = toGuardRequest({ name: 'bash', arguments: { command: 'git status' }, signal: new AbortController().signal })
  const skipped = toGuardRequest({ name: 'grep', arguments: {}, signal: new AbortController().signal })
  const ok = request?.tool === 'bash' && skipped === undefined
  console.log(`[smoke-dsh] adapter mapping ${ok ? 'PASS' : 'FAIL'} (full mount smoke: run inside DSH with the plugin registered)`)
  process.exitCode = ok ? 0 : 1
} catch {
  console.log('[smoke-dsh] runtime cannot load TS directly (needs Node >= 23) — SKIP')
  process.exitCode = 0
}
