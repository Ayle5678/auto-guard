/**
 * SPEC 0013 migration checkpoint: byte-identity snapshot of the four hook
 * hosts' user-visible surfaces (hook-cli payloads + management CLI output).
 *
 * Run against a freshly built workspace:
 *   pnpm -r build && node .scratch/0013-host-runtime/snapshot.mjs <outDir>
 *
 * Each row runs in a pristine fake HOME with a fixed path (so embedded paths
 * are stable) and autoAnalyzeEnabled:false (no detached analysis spawns).
 * Compare two snapshots with diff -r to prove "切换前后逐字节一致".
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOSTS = ['zcode', 'claude', 'qoder', 'opencode']

/** Payload battery: every row avoids the LLM (static rules / sensitive gates / protocol errors only). */
function hookRows(host) {
  const rows = [
    ['allow static git status', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } }],
    ['deny hard rm -rf /', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }],
    ['two-phase dir delete', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf ./build' } }],
    ['sensitive ask .env write', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '.env', content: 'A=1' } }],
    ['untracked passthrough', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } }],
    ['unreviewable bash empty input', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }],
    ['unreviewable write no path', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {} }],
  ]
  if (host === 'zcode') rows.push(['ApplyPatch edit no content', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'ApplyPatch', tool_input: { file_path: 'x.txt' } }])
  if (host === 'claude') rows.push(['NotebookEdit no content', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: 'nb.ipynb' } }])
  if (host === 'qoder') {
    rows.push(
      ['run_in_terminal allow', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'run_in_terminal', tool_input: { command: 'git status' } }],
      ['create_file sensitive ask', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'create_file', tool_input: { file_path: '.env', content: 'A=1' } }],
      ['delete_file (SPEC 0012 watch row)', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'delete_file', tool_input: { path: 'C:/a' } }],
    )
  }
  if (host === 'opencode') {
    // The plugin spawns the CLI with guard-side tool names already resolved.
    return [
      ['allow static git status', { tool_name: 'bash', tool_input: { command: 'git status' }, session_id: 's1', cwd: 'D:/w' }],
      ['deny hard rm -rf /', { tool_name: 'bash', tool_input: { command: 'rm -rf /' }, session_id: 's1', cwd: 'D:/w' }],
      ['two-phase dir delete', { tool_name: 'bash', tool_input: { command: 'rm -rf ./build' }, session_id: 's1', cwd: 'D:/w' }],
      ['sensitive ask .env edit', { tool_name: 'edit', tool_input: { file_path: 'D:/w/.env', content: 'A=1' }, session_id: 's1', cwd: 'D:/w' }],
      ['untracked permission type', { tool_name: 'glob', tool_input: { pattern: '**/*' }, session_id: 's1', cwd: 'D:/w' }],
      ['unreviewable bash empty input', { tool_name: 'bash', tool_input: {}, session_id: 's1', cwd: 'D:/w' }],
      ['unreviewable edit no path', { tool_name: 'edit', tool_input: {}, session_id: 's1', cwd: 'D:/w' }],
    ]
  }
  return rows
}

const CLI_ROWS = [
  ['usage no args', ''],
  ['guard usage', 'guard'],
  ['guard status', 'guard status'],
  ['guard recent', 'guard recent'],
  ['guard stats', 'guard stats'],
  ['set usage', 'set'],
  ['set show-key', 'set show-key'],
  ['set-api usage', 'set set-api'],
  ['set history on', 'set history on'],
  ['examine usage', 'examine'],
  ['examine status', 'examine status'],
  ['examine on', 'examine on'],
  ['optimize usage', 'optimize'],
  ['optimize status', 'optimize status'],
  ['optimize list', 'optimize list'],
]

function configDirFor(host) {
  if (host === 'zcode') return ['.zcode', 'auto-guard']
  if (host === 'claude') return ['.claude', 'auto-guard']
  if (host === 'qoder') return ['.qoder', 'auto-guard']
  return ['.config', 'opencode', 'auto-guard']
}

function freshHome(host, rowKey) {
  const home = join(tmpdir(), 'ag-snap', host, rowKey.replaceAll(' ', '_'))
  rmSync(home, { recursive: true, force: true })
  const dir = join(home, ...configDirFor(host))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ enabled: true, autoAnalyzeEnabled: false }, null, 2), 'utf8')
  return home
}

function runRow(host, kind, key, payloadOrArgs) {
  const home = freshHome(host, `${kind}-${key}`)
  const env = { ...process.env, USERPROFILE: home, HOME: home, AUTO_GUARD_CLI_ENTRY: '1' }
  delete env.AUTO_GUARD_LANG
  const dist = join(process.cwd(), 'packages', `host-${host}`, 'dist')
  if (kind === 'hook') {
    const res = spawnSync(process.execPath, [join(dist, 'hook-cli.js')], {
      input: payloadOrArgs,
      encoding: 'utf8',
      env,
      timeout: 60_000,
    })
    return { stdout: res.stdout, stderr: res.stderr.slice(0, 400), status: res.status }
  }
  const res = spawnSync(process.execPath, [join(dist, 'cli.js'), ...payloadOrArgs], {
    encoding: 'utf8',
    env,
    timeout: 60_000,
  })
  return { stdout: res.stdout, stderr: res.stderr.slice(0, 400), status: res.status }
}

const outDir = process.argv[2]
if (!outDir || !existsSync('packages')) {
  console.error('usage: node .scratch/0013-host-runtime/snapshot.mjs <outDir>  (from repo root, after pnpm -r build)')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })
for (const host of HOSTS) {
  const rows = {}
  for (const [key, payload] of hookRows(host)) {
    rows[`hook: ${key}`] = runRow(host, 'hook', key, key === 'bad stdin' ? payload : JSON.stringify(payload))
  }
  rows['hook: bad stdin'] = runRow(host, 'hook', 'bad stdin', 'not json at all')
  for (const [key, cmdline] of CLI_ROWS) {
    rows[`cli: ${key}`] = runRow(host, 'cli', key, cmdline ? cmdline.split(' ') : [])
  }
  const file = join(outDir, `${host}.json`)
  writeFileSync(file, JSON.stringify(rows, null, 2) + '\n', 'utf8')
  console.log(`[snapshot] ${file} (${Object.keys(rows).length} rows)`)
}
rmSync(join(tmpdir(), 'ag-snap'), { recursive: true, force: true })
