#!/usr/bin/env node
/**
 * review-loop — 审查反馈循环回归工具（grill-log Round 7 / 工单 0008-01）。
 *
 * 目的：锁定 core `httpPostText` 的 one-shot 传输行为（node:http/https +
 * `agent: false`，连接随响应关闭，零池化）。Round 7 实证：全局 fetch（undici）
 * 的 keep-alive 池化连接与宿主 hook 的 `process.exit()` 在 Windows 上竞态，
 * 触发 libuv `uv_async_send` 断言 → 0xC0000409 崩溃。本工具把当时的反馈循环
 * 脚本转正为正式回归工件：每次 run 以 spawnSync 走真实宿主 `dist/hook-cli.js`
 * （跑前先 `pnpm -r build`），stdin 喂 hook payload，事后断言裁决确实触网。
 *
 * 统计口径（防缓存污染，2026-08-29 教训）：
 *   - 命令按 `alias ag-loop-<时间戳>-<i>-<随机数>=…` 全局唯一，杜绝 30 分钟
 *     持久缓存（alwaysReviewCacheTtlMinutes）与会话缓存短路；
 *   - 崩溃率分母 = 触网样本：`<config-root>/status.json` 的
 *     `lastDecisionSource === 'llm'` 且 `reviewerLastFailed` 非真；
 *   - 缓存/静态短路样本不计入分母，但逐样本显式报告；
 *   - 崩溃判定双条件：非零退出码 + stderr 含 `Assertion failed`；
 *     其余非零退出单列为 anomaly（hook 契约是恒 0 退出）。
 *
 * 模式：
 *   默认      mock over plain http（node:http），恒用临时 HOME 隔离 config root
 *   --https   mock 换自签 TLS（node:https + NODE_EXTRA_CA_CERTS 指 fixtures/tls/
 *             ca-cert.pem），验证 https 分支同样零池化零崩溃
 *   --live    真实 API。烧真实配额且有网络抖动，绝不进 CI（结论 2026-08-29：
 *             mock 模式可进 CI 作传输层回归，见下；live 的价值在排查期，
 *             不适合做无人值守回归）。非 isolate 时直接用真实 HOME，
 *             会写真实 status/decision-history/audit。
 *   --isolate 与 --live 连用：临时 HOME + 密钥注入（key 经 core `loadApiKey`
 *             从真实 config root 水合、`saveApiKey` 落到临时目录加密存储，
 *             config 副本剥离明文 apiKey 字段；任何输出不落密钥）。
 *
 * CI 结论（研究项 4，2026-08-29）：本仓库当前无 CI 流水线；接入方式已留好 ——
 *   mock 两分支各跑一轮即可作传输层回归（`pnpm review-loop --times N` 与
 *   `pnpm review-loop --times N --https`），秒级/次、零外部依赖；live 永不进。
 *
 * 用法：
 *   node packages/conformance/review-loop.mjs [--times 30] [--host zcode]
 *        [--https] [--live] [--isolate] [--check-isolate] [--clean]
 *   退出码 0 = 全绿（触网样本数 === times、0 崩溃、0 anomaly、0 reviewer 失败、
 *   mock 下无慢样本）；否则 1。每次 run 的 stdout/stderr/exit/耗时/status 快照
 *   落盘于 `<tmpdir>/ag-review-loop-<stamp>/`，路径见结尾报告；--clean 跑完即删。
 *   --check-isolate 只做 live --isolate 的准备+密钥回读自检（不发起任何 LLM 请求、
 *   不烧配额），用于离线验证隔离链路。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadApiKey, saveApiKey } from '@auto-guard/core'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

/** Hosts with a `dist/hook-cli.js` PreToolUse entry and their config-root subpath under HOME. */
const HOSTS = {
  zcode: { hookCli: 'packages/host-zcode/dist/hook-cli.js', configRoot: ['.zcode', 'auto-guard'] },
  opencode: { hookCli: 'packages/host-opencode/dist/hook-cli.js', configRoot: ['.config', 'opencode', 'auto-guard'] },
  qoder: { hookCli: 'packages/host-qoder/dist/hook-cli.js', configRoot: ['.qoder', 'auto-guard'] },
  codex: { hookCli: 'packages/host-codex/dist/hook-cli.js', configRoot: ['.codex', 'auto-guard'] },
  claude: { hookCli: 'packages/host-claude/dist/hook-cli.js', configRoot: ['.claude', 'auto-guard'] },
}

const MOCK_API_KEY_ENV = 'AG_REVIEW_LOOP_MOCK_KEY'
const SLOW_RUN_MS = 15_000

function parseArgs(argv) {
  const opts = { times: 30, host: 'zcode', https: false, live: false, isolate: false, clean: false, checkIsolate: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--times') opts.times = Number(argv[++i])
    else if (arg === '--host') opts.host = argv[++i]
    else if (arg === '--https') opts.https = true
    else if (arg === '--live') opts.live = true
    else if (arg === '--isolate') opts.isolate = true
    else if (arg === '--clean') opts.clean = true
    else if (arg === '--check-isolate') opts.checkIsolate = true
    else {
      console.error(`未知参数: ${arg}`)
      process.exit(2)
    }
  }
  if (!Number.isInteger(opts.times) || opts.times < 1) {
    console.error('--times 需要正整数')
    process.exit(2)
  }
  if (!HOSTS[opts.host]) {
    console.error(`--host 可选: ${Object.keys(HOSTS).join(' | ')}（dsh/pi 无 hook-cli 入口）`)
    process.exit(2)
  }
  if ((opts.isolate || opts.checkIsolate) && !opts.live) {
    console.error('--isolate/--check-isolate 只与 --live 连用（mock 恒隔离）')
    process.exit(2)
  }
  return opts
}

/**
 * Mock DeepSeek endpoint as a SEPARATE process: under some sandbox policies a
 * spawned child cannot reach a socket owned by its parent process, while
 * sibling processes connect fine. Port and hit count travel via a JSON state
 * file (`review-loop-mock-server.mjs` rewrites it per request).
 */
function startMockServer(httpsMode, stateFile) {
  const child = spawn(process.execPath, [
    join(here, 'review-loop-mock-server.mjs'),
    '--state', stateFile,
    ...(httpsMode ? ['--https'] : []),
  ], { stdio: ['pipe', 'ignore', 'inherit'] })
  const deadline = Date.now() + 10_000
  while (!existsSync(stateFile) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
  if (!existsSync(stateFile)) throw new Error('mock server 未在 10s 内就绪')
  return { child }
}

function mockStateOf(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return { port: 0, hits: 0 }
  }
}

/** Fresh isolated HOME; the child's `os.homedir()` (USERPROFILE/HOME) resolves here. */
function makeHome() {
  return mkdtempUnder(tmpdir(), 'ag-review-loop-home-')
}

function mkdtempUnder(parent, prefix) {
  const dir = join(parent, `${prefix}${Date.now()}-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeMockConfig(home, host, apiBase) {
  const dir = join(home, ...HOSTS[host].configRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    enabled: true,
    apiBase,
    apiKeyEnv: MOCK_API_KEY_ENV,
    timeoutMs: 8000,
  }, null, 2))
}

/**
 * Live --isolate: copy the real config (secrets stripped) into the temp HOME and
 * re-encrypt the resolved key into it via core saveApiKey. Never prints the key.
 * A key supplied via the apiKeyEnv environment variable needs no injection —
 * the child inherits the env; stored/config keys are re-encrypted into the
 * temp HOME.
 */
function prepareIsolatedLiveHome(host) {
  const realDir = join(homedir(), ...HOSTS[host].configRoot)
  const realConfigPath = join(realDir, 'config.json')
  if (!existsSync(realConfigPath)) {
    console.error(`live --isolate: 真实 config 不存在: ${realConfigPath}`)
    process.exit(2)
  }
  const realConfig = JSON.parse(readFileSync(realConfigPath, 'utf8'))
  const envKey = process.env[realConfig.apiKeyEnv] || process.env.DEEPSEEK_API_KEY
  const storedKey = loadApiKey(realDir) ?? (typeof realConfig.apiKey === 'string' && realConfig.apiKey ? realConfig.apiKey : undefined)
  if (!envKey && !storedKey) {
    console.error(`live --isolate: 真实 config root 无可用密钥（apiKeyEnv 未设、loadApiKey 为空、config.apiKey 为空）: ${realDir}`)
    process.exit(2)
  }
  const home = makeHome()
  const dir = join(home, ...HOSTS[host].configRoot)
  mkdirSync(dir, { recursive: true })
  const { apiKey, apiKeyMasked, ...rest } = realConfig
  writeFileSync(join(dir, 'config.json'), JSON.stringify(rest, null, 2))
  if (storedKey) saveApiKey(dir, storedKey)
  return home
}

function uniqueRunId(i, stamp) {
  return `${stamp}-${i}-${randomBytes(4).toString('hex')}`
}

/** The always-LLM probe: `alias` is a high-risk state changer, so the whole compound goes straight to llmDecision (no cache path). */
function probeCommand(runId) {
  return `alias ag-loop-${runId}=echo ok`
}

function hookPayload(runId, command) {
  return JSON.stringify({
    session_id: `ag-loop-${runId}`,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { hookCli, configRoot } = HOSTS[opts.host]
  const hookCliPath = join(repoRoot, hookCli)
  if (!existsSync(hookCliPath)) {
    console.error(`缺少 ${hookCli} —— 先跑 pnpm -r build`)
    process.exit(2)
  }

  let mock = null
  let mockStateFile = null
  let home
  let childEnvBase = process.env
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
  const mode = opts.live ? 'live' : `mock/${opts.https ? 'https' : 'http'}`
  const artifactsDir = join(tmpdir(), `ag-review-loop-${stamp}`)
  mkdirSync(artifactsDir, { recursive: true })

  if (!opts.live) {
    mockStateFile = join(artifactsDir, 'mock-state.json')
    mock = startMockServer(opts.https, mockStateFile)
    const { port } = mockStateOf(mockStateFile)
    home = makeHome()
    writeMockConfig(home, opts.host, `${opts.https ? 'https' : 'http'}://127.0.0.1:${port}`)
    childEnvBase = { ...process.env }
    if (opts.https) childEnvBase.NODE_EXTRA_CA_CERTS = join(here, 'fixtures', 'tls', 'ca-cert.pem')
    childEnvBase[MOCK_API_KEY_ENV] = 'mock-key-not-a-secret'
    console.log(`[review-loop] mock ${opts.https ? 'https' : 'http'}://127.0.0.1:${port}  host=${opts.host}  times=${opts.times}`)
  } else if (opts.isolate || opts.checkIsolate) {
    home = prepareIsolatedLiveHome(opts.host)
    if (opts.checkIsolate) {
      const dir = join(home, ...HOSTS[opts.host].configRoot)
      const hydrated = loadApiKey(dir)
      if (!hydrated) {
        console.error('live --isolate 自检失败: 注入后 loadApiKey 读不到密钥')
        process.exit(1)
      }
      console.log(`[review-loop] live --isolate 自检 OK  host=${opts.host}  密钥注入+回读成功（未打印内容）  临时 HOME 已隔离`)
      rmSync(home, { recursive: true, force: true })
      return
    }
    console.log(`[review-loop] live --isolate  host=${opts.host}  times=${opts.times}  （临时 HOME，密钥已注入）`)
  } else {
    home = homedir()
    console.log(`[review-loop] live（真实 HOME，会写真实 status/decision-history/audit）  host=${opts.host}  times=${opts.times}`)
  }

  const childEnv = { ...childEnvBase, USERPROFILE: home, HOME: home }
  const statusPath = join(home, ...configRoot, 'status.json')

  const runs = []
  for (let i = 0; i < opts.times; i++) {
    const runId = uniqueRunId(i, stamp)
    const command = probeCommand(runId)
    const started = Date.now()
    const result = spawnSync(process.execPath, [hookCliPath], {
      input: hookPayload(runId, command),
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      env: childEnv,
    })
    const durationMs = Date.now() - started
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    const exit = result.status
    let status = null
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf8'))
    } catch {
      status = null
    }
    const source = status?.lastDecisionSource
    const reviewerFailed = status?.reviewerLastFailed === true
    const touchedLlm = source === 'llm' && !reviewerFailed
    const shortCircuited = !touchedLlm && !reviewerFailed && typeof source === 'string' && source !== 'llm'
    const crashed = exit !== 0 && /Assertion failed/i.test(stderr)
    const anomaly = (exit !== 0 && !crashed) || status === null
    const slow = !opts.live && durationMs > SLOW_RUN_MS
    const run = { i, runId, command, exit, signal: result.signal ?? null, durationMs, touchedLlm, source, reviewerFailed, shortCircuited, crashed, anomaly, slow, stdout, stderr: stderr.slice(-4000) }
    runs.push(run)
    writeFileSync(join(artifactsDir, `run-${String(i).padStart(3, '0')}.json`), JSON.stringify(run, null, 2))
    if (!touchedLlm || crashed || anomaly || slow) {
      console.log(`[review-loop] run ${i}: exit=${exit} source=${source ?? '<no-status>'} reviewerFailed=${reviewerFailed} crashed=${crashed} anomaly=${anomaly} slow=${slow} (${durationMs}ms)`)
    }
  }

  const llmPath = runs.filter((r) => r.touchedLlm).length
  const shortCircuits = runs.filter((r) => r.shortCircuited).length
  const reviewerFailures = runs.filter((r) => r.reviewerFailed).length
  const crashes = runs.filter((r) => r.crashed).length
  const anomalies = runs.filter((r) => r.anomaly).length
  const slowRuns = runs.filter((r) => r.slow).length
  const mockHits = mock ? mockStateOf(mockStateFile).hits : llmPath

  const green = llmPath === opts.times && crashes === 0 && anomalies === 0 && reviewerFailures === 0 && slowRuns === 0 && (!mock || mockHits === llmPath)
  const durations = runs.map((r) => r.durationMs)
  console.log('─'.repeat(72))
  console.log(`review-loop  mode=${mode}  host=${opts.host}  times=${opts.times}`)
  console.log(`crashes: ${crashes}/${opts.times}  (llm-path: ${llmPath}/${opts.times} 触网样本计入分母)`)
  console.log(`缓存/静态短路（不计入分母）: ${shortCircuits}`)
  console.log(`reviewer 失败（请求未成功）: ${reviewerFailures}`)
  console.log(`anomaly（非零退出/无 status）: ${anomalies}`)
  console.log(`慢样本(>${SLOW_RUN_MS}ms, 仅 mock): ${slowRuns}`)
  if (mock) console.log(`mock server 收到请求数: ${mockHits}`)
  console.log(`耗时 ms: min=${Math.min(...durations)} max=${Math.max(...durations)} avg=${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}`)
  console.log(`结论: ${green ? 'GREEN' : 'RED'}`)
  console.log(`artifacts: ${artifactsDir}${opts.clean ? '（已清理）' : ''}`)

  writeFileSync(join(artifactsDir, 'summary.json'), JSON.stringify({
    mode, host: opts.host, times: opts.times, llmPath, shortCircuits, reviewerFailures, crashes, anomalies, slowRuns, mockHits, green,
    runs: runs.map(({ stdout, stderr, ...rest }) => rest),
  }, null, 2))

  if (mock) mock.child.kill()
  if (opts.clean) rmSync(artifactsDir, { recursive: true, force: true })
  if (home && home !== homedir()) rmSync(home, { recursive: true, force: true })
  process.exitCode = green ? 0 : 1
}

main().catch((error) => {
  console.error('[review-loop] 自身异常:', error)
  process.exitCode = 2
})
