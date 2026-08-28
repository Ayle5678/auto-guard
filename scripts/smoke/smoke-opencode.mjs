// End-to-end smoke for the OpenCode adapter: load the BUILT plugin module
// (dist/plugin.js) exactly like opencode's bun runtime would, fire synthetic
// `permission.asked` bus events at its event hook with a fake reply client,
// and assert the full chain: plugin → spawn node dist/hook-cli.js → verdict
// → reply mapping. allow → "once", hard-deny → "reject", ask-sensitive-file
// → no reply (native TUI). Also exercises dedup on event replay.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', '..', 'packages', 'host-opencode', 'dist')
const home = mkdtempSync(join(tmpdir(), 'ag-smoke-oc-'))
const configDir = join(home, '.config', 'opencode', 'auto-guard')
mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

const replies = []
const input = {
  client: {
    permission: {
      reply: async (p) => {
        replies.push(p)
        return {}
      },
    },
  },
  project: {},
  directory: home,
  worktree: 'D:/work/demo',
  serverUrl: new URL('http://127.0.0.1:1'),
  $: {},
}

process.env.USERPROFILE = home
process.env.HOME = home

const { AutoGuard } = await import(`file://${dist.replaceAll('\\', '/')}/plugin.js`)
const hooks = await AutoGuard(input)

const fire = (id, permission, metadata, patterns) =>
  hooks.event({ event: { id: `evt_${id}`, type: 'permission.asked', properties: { id, sessionID: 'ses_smoke', permission, patterns, metadata } } })

// 1. allow: static-whitelisted bash command → auto-approved with "once"
await fire('perm_allow', 'bash', { command: 'git status' }, [])
// 2. deny: hard-deny bash command → rejected with a reason
await fire('perm_deny', 'bash', { command: 'rm -rf /' }, [])
// 3. ask: sensitive file write → no reply (native TUI decides)
await fire('perm_ask', 'edit', { filepath: 'D:/work/demo/.env', diff: 'SECRET=1' }, [])
// 4. dedup: replaying the allow event must not answer twice
await fire('perm_allow', 'bash', { command: 'git status' }, [])

const once = replies.filter((r) => r.reply === 'once')
const reject = replies.filter((r) => r.reply === 'reject')
const allowOk = once.length === 1 && once[0].requestID === 'perm_allow'
const denyOk = reject.length === 1 && reject[0].requestID === 'perm_deny' && typeof reject[0].message === 'string' && reject[0].message.length > 0
const askOk = !replies.some((r) => r.requestID === 'perm_ask')
const dedupOk = once.length === 1

console.log(`[smoke-opencode] allow→once: ${allowOk ? 'PASS' : 'FAIL'} (${JSON.stringify(once)})`)
console.log(`[smoke-opencode] deny→reject(reason): ${denyOk ? 'PASS' : 'FAIL'} (${JSON.stringify(reject)})`)
console.log(`[smoke-opencode] ask→no-reply(TUI): ${askOk ? 'PASS' : 'FAIL'}`)
console.log(`[smoke-opencode] replay dedup: ${dedupOk ? 'PASS' : 'FAIL'}`)
rmSync(home, { recursive: true, force: true })
process.exitCode = allowOk && denyOk && askOk && dedupOk ? 0 : 1
