/**
 * Real-CLI language smoke (SPEC 0004 ticket 05): three scenarios against the
 * TypeScript entry (node packages/cli/src/auto-guard.ts) with an isolated
 * USERPROFILE — (a) English machine default, (b) zh fallback, (c) env
 * override beating the machine default — plus a `set lang` round-trip.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const entry = join(repo, 'packages', 'cli', 'src', 'auto-guard.ts')

const homes = []
function home(label) {
  const h = mkdtempSync(join(tmpdir(), `ag-smoke-${label}-`))
  homes.push(h)
  // A seeded zcode root so the management commands have a config to read.
  const root = join(h, '.zcode', 'auto-guard')
  mkdirSync(root, { recursive: true })
  return { h, root }
}

function run(h, args, extraEnv = {}) {
  const res = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: h, HOME: h, ...extraEnv },
  })
  return { code: res.status, out: `${res.stdout}${res.stderr}`.trim() }
}

function check(name, ok, detail) {
  if (!ok) {
    console.error(`FAIL ${name}\n${detail}`)
    process.exitCode = 1
  } else {
    console.log(`[smoke-lang] ${name} OK`)
  }
}

// (a) English machine default drives the management CLI.
{
  const { h, root } = home('en')
  mkdirSync(join(h, '.auto-guard'), { recursive: true })
  writeFileSync(join(h, '.auto-guard', 'config.json'), JSON.stringify({ lang: 'en' }), 'utf8')
  const status = run(h, ['guard', 'status', '--config-root', root])
  check('en machine default: status shows lang : en', status.out.includes('lang    : en'), status.out)
  check('en machine default: English wording', status.out.includes('no API Key (fail-closed)'), status.out)
  const usage = run(h, ['optimize', '--config-root', root])
  check('en machine default: English usage line', usage.out.includes('Usage: auto-guard optimize'), usage.out)
}

// (b) No machine default, no config lang: zh fallback everywhere.
{
  const { h, root } = home('zh')
  const status = run(h, ['guard', 'status', '--config-root', root])
  check('zh fallback: status shows lang : zh', status.out.includes('lang    : zh'), status.out)
  check('zh fallback: Chinese wording', status.out.includes('⚠ 无 API Key（fail-closed）'), status.out)
}

// (c) AUTO_GUARD_LANG beats the machine default for one invocation.
{
  const { h, root } = home('env')
  mkdirSync(join(h, '.auto-guard'), { recursive: true })
  writeFileSync(join(h, '.auto-guard', 'config.json'), JSON.stringify({ lang: 'en' }), 'utf8')
  const status = run(h, ['guard', 'status', '--config-root', root], { AUTO_GUARD_LANG: 'zh' })
  check('env override: zh wins over en machine default', status.out.includes('lang    : zh') && status.out.includes('无 API Key'), status.out)
  // Without the env var the machine default still rules.
  const back = run(h, ['guard', 'status', '--config-root', root])
  check('env override is one-shot (machine default restored)', back.out.includes('lang    : en'), back.out)
}

// (d) set lang round-trip on the real CLI.
{
  const { h, root } = home('set')
  const en = run(h, ['set', 'lang', 'en', '--config-root', root])
  check('set lang en: English receipt', en.out.includes('Language set: en'), en.out)
  const stored = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  check('set lang en: persisted to the config root', stored.lang === 'en', JSON.stringify(stored))
  const zh = run(h, ['set', 'lang', 'zh', '--config-root', root])
  check('set lang zh: Chinese receipt', zh.out.includes('语言已设置：zh'), zh.out)
}

for (const h of homes) {
  try {
    rmSync(h, { recursive: true, force: true })
  } catch {
    // SQLite/WAL handles may linger briefly on Windows; the temp sweeper wins.
  }
}
if (process.exitCode) {
  console.error('[smoke-lang] FAILED')
} else {
  console.log('[smoke-lang] PASS')
}
