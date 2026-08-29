#!/usr/bin/env node
/**
 * Mock DeepSeek `/chat/completions` endpoint for `review-loop.mjs` — run as a
 * SEPARATE process (not an in-process listener of the tool): under some
 * sandbox policies a spawned child cannot reach a socket owned by its parent
 * process, while sibling processes connect fine. The port and hit count travel
 * via a JSON state file the tool polls and reads.
 *
 *   node review-loop-mock-server.mjs --state <file> [--https] [--certs <dir>]
 *
 * Exits when stdin closes (parent death) or after 15 minutes of idling.
 */
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const opts = { state: null, https: false, certs: join(here, 'fixtures', 'tls') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--state') opts.state = argv[++i]
    else if (argv[i] === '--https') opts.https = true
    else if (argv[i] === '--certs') opts.certs = argv[++i]
  }
  if (!opts.state) {
    console.error('--state <file> 必填')
    process.exit(2)
  }
  return opts
}

function writeState(stateFile, patch) {
  let current = {}
  try {
    current = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    // First write or reader raced a rewrite — start fresh.
  }
  writeFileSync(stateFile, JSON.stringify({ ...current, ...patch }))
}

const opts = parseArgs(process.argv.slice(2))
const state = { hits: 0 }

const respond = (req, res) => {
  if (req.method === 'POST' && req.url === '/chat/completions') {
    state.hits++
    writeState(opts.state, { hits: state.hits })
    const content = JSON.stringify({ decision: 'allow', risk: 'low', reason: 'review-loop mock: allow' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    return
  }
  res.writeHead(404)
  res.end()
}

const server = opts.https
  ? createHttpsServer({
      key: readFileSync(join(opts.certs, 'server-key.pem')),
      cert: readFileSync(join(opts.certs, 'server-cert.pem')),
    }, respond)
  : createServer(respond)

const idleTimer = setTimeout(() => process.exit(0), 15 * 60 * 1000)
idleTimer.unref()
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

server.listen(0, '127.0.0.1', () => {
  writeState(opts.state, { port: server.address().port, hits: 0, https: opts.https })
  console.log(`[mock-server] listening on ${opts.https ? 'https' : 'http'}://127.0.0.1:${server.address().port}`)
})
