#!/usr/bin/env node
/**
 * Management CLI for the Qoder host adapter — thin terminal rendering over the
 * shared core operations layer (ADR-0009).
 *
 * Secret handling: API keys are never accepted as argv (shell history would
 * capture them). `set set-key` reads the key from a TTY with echo disabled and
 * stores it AES-GCM-encrypted (core key-store); the env var remains primary.
 *
 * Usage: node dist/cli.js <group> <action> [args]
 */
import { createInterface } from 'node:readline'
import {
  analysisIntervalMs,
  clearApiKey,
  createAuditStore,
  DeepSeekReviewer,
  formatLocalTime,
  hasStoredApiKey,
  hydrateApiKey,
  loadAnalyzeState,
  loadAuditPassword,
  loadApiKey,
  loadLearnedRules,
  loadRules,
  maskKey,
  saveApiKey,
  analyzeLearnedRules,
  applyHistoryToggle,
  applySetApi,
  examineStatusLines,
  langOf,
  optimizeListLines,
  optimizeStatusLines,
  recentLines,
  reportLines,
  rollbackLearnedRules,
  setEnabled,
  statusLines,
  updateLastAnalysis,
  } from '@auto-guard/core'
import { AUTO_GUARD_DIR, DEFAULT_CONFIG_PATH, defaultConfig, loadConfig, saveConfig } from './config.ts'
import { appendDecisionHistory, bootstrap, readRecentDecisions, readStatus } from './bootstrap.ts'

function print(message: string): void {
  process.stdout.write(`${message}\n`)
}

async function main(argv: readonly string[]): Promise<number> {
  const [group, action = '', ...rest] = argv
  switch (group) {
    case 'guard':
      return guardCommand(action, rest)
    case 'set':
      return setCommand(action, rest)
    case 'examine':
      return examineCommand(action)
    case 'optimize':
      return optimizeCommand(action)
    default:
      print('用法：node dist/cli.js <guard|set|examine|optimize> <action>')
      return 1
  }
}

function auditFor(config: ReturnType<typeof loadConfig>) {
  return createAuditStore(config.auditDbPath, loadAuditPassword(AUTO_GUARD_DIR))
}

function guardCommand(action: string, rest: readonly string[] = []): number | Promise<number> {
  // Read-only group: hydrate the encrypted key so status/ping see it.
  const config = hydrateApiKey(loadConfig(), () => loadApiKey(AUTO_GUARD_DIR))
  switch (action) {
    case 'on':
    case 'off': {
      print(setEnabled(config, action === 'on'))
      saveConfig(config, DEFAULT_CONFIG_PATH)
      return 0
    }
    case 'status': {
      print(statusLines(config, readStatus(), `${AUTO_GUARD_DIR}/config.json`).join('\n'))
      return 0
    }
    case 'stats': {
      if (config.examineEnabled) {
        const audit = auditFor(config)
        try {
          print(`审计库记录总数：${audit.count()}（学习分析数据源）`)
        } finally {
          audit.close()
        }
      } else {
        print('审查日志未开启（cli.js examine on 后才有持久统计）')
      }
      return 0
    }
    case 'report': {
      const days = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : 7
      if (!config.examineEnabled) {
        print('审查日志未开启（cli.js examine on 后才有持久统计）')
        return 0
      }
      const audit = auditFor(config)
      try {
        print(reportLines(audit.summarizeSince(days), days, langOf(config)).join('\n'))
      } finally {
        audit.close()
      }
      return 0
    }
    case 'recent': {
      const count = Number(rest[0]) > 0 ? Number(rest[0]) : 10
      print(recentLines(readRecentDecisions(count), count).join('\n'))
      return 0
    }
    case 'ping': {
      const reviewer = new DeepSeekReviewer(config)
      return reviewer.ping().then((result) => {
        print(result.ok ? 'API 联通成功' : `API 联通失败：${result.error ?? '未知错误'}`)
        return result.ok ? 0 : 2
      })
    }
    default:
      print('用法：node dist/cli.js guard <on|off|status|recent|stats|report|ping>')
      return 1
  }
}

function setCommand(action: string, rest: readonly string[]): number | Promise<number> {
  const config = loadConfig()
  switch (action) {
    case 'set-key':
      return setKeyInteractive(config)
    case 'show-key': {
      const envSet = Boolean(process.env[config.apiKeyEnv])
      print(
        [
          `env ${config.apiKeyEnv}: ${envSet ? '已设置（优先于本地存储）' : '未设置'}`,
          `stored     : ${hasStoredApiKey(AUTO_GUARD_DIR) ? `已存储（AES-GCM 加密于 ${AUTO_GUARD_DIR}/api-key.json）` : '(未存储)'}`,
          `legacy     : ${config.apiKey && !config.apiKey.startsWith('v1:') ? `${maskKey(config.apiKey)}（config.json 明文遗留，建议 set-key 重存）` : '(无)'}`,
        ].join('\n'),
      )
      return 0
    }
    case 'clear-key': {
      clearApiKey(AUTO_GUARD_DIR)
      print('已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）')
      return 0
    }
    case 'set-api': {
      const [sub, value] = rest
      const result = applySetApi(config, sub, value, defaultConfig())
      if (result.ok) saveConfig(config, DEFAULT_CONFIG_PATH)
      print(result.message)
      return result.ok ? 0 : 1
    }
    case 'history': {
      const result = applyHistoryToggle(config, rest[0])
      if (result.ok) saveConfig(config, DEFAULT_CONFIG_PATH)
      print(result.messages.join('\n'))
      return result.ok ? 0 : 1
    }
    case 'reload':
      // Kept for muscle-memory parity; hooks re-read on every process.
      loadConfig()
      print('配置与规则在每次 hook 进程启动时自动重读')
      return 0
    default:
      print('用法：node dist/cli.js set <set-key|show-key|clear-key|set-api|history|reload>')
      return 1
  }
}

function examineCommand(action: string): number {
  const config = loadConfig()
  switch (action) {
    case 'on': {
      config.examineEnabled = true
      saveConfig(config, DEFAULT_CONFIG_PATH)
      print('审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）')
      return 0
    }
    case 'off': {
      config.examineEnabled = false
      saveConfig(config, DEFAULT_CONFIG_PATH)
      print('审查日志已关闭')
      return 0
    }
    case 'status': {
      print(examineStatusLines(config).join('\n'))
      return 0
    }
    case 'clear-old':
    case 'clear-all': {
      const audit = auditFor(config)
      try {
        if (action === 'clear-old') {
          print(`已删除 ${audit.clearOld(30)} 条 30 天前记录`)
        } else {
          audit.clearAll()
          print('已清空全部审查日志')
        }
      } finally {
        audit.close()
      }
      return 0
    }
    default:
      print('用法：node dist/cli.js examine <on|off|status|clear-old|clear-all>')
      return 1
  }
}

function optimizeCommand(action: string): number {
  const config = loadConfig()
  switch (action) {
    case 'status': {
      print(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt).join('\n'))
      return 0
    }
    case 'analyze': {
      const runtime = bootstrap()
      try {
        const result = analyzeLearnedRules({ config: runtime.config, rules: runtime.rules, audit: runtime.audit })
        print(result.message)
        if (result.ok) updateLastAnalysis(config.analyzeStatePath)
        return result.ok ? 0 : 2
      } finally {
        runtime.audit.close()
      }
    }
    case 'auto': {
      print('用法：node dist/cli.js set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled')
      return 1
    }
    case 'list': {
      print(optimizeListLines(loadLearnedRules(config.learnedRulesPath)).join('\n'))
      return 0
    }
    case 'rollback': {
      const result = rollbackLearnedRules(config)
      print(result.message)
      return result.ok ? 0 : 2
    }
    default:
      print('用法：node dist/cli.js optimize <status|analyze|list|rollback>')
      return 1
  }
}

/**
 * Interactive `set set-key`: a three-step wizard — review endpoint base URL,
 * model name, then the API key (echo disabled). Each step accepts Enter to
 * keep the current value. The key never passes through argv or the chat.
 */
async function setKeyInteractive(config: ReturnType<typeof loadConfig>): Promise<number> {
  if (!process.stdin.isTTY) {
    print('set set-key 需要交互式终端（IDE 内置终端即可）。请不要把 Key 粘贴到对话中——那会进入会话日志。')
    return 2
  }
  if (process.env[config.apiKeyEnv]) {
    print(`⚠ 环境变量 ${config.apiKeyEnv} 已设置且优先于本地存储；继续存储仅作为无环境变量环境的兜底。`)
  }

  // Steps 1-2 are not secrets: plain readline with echo.
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer)))
  print('—— auto-guard 审查端点配置向导（任意一步直接回车 = 保持当前值）——')
  const baseAnswer = (await ask(`[1/3] 审查端点 base URL（回车 = ${config.apiBase}）: `)).trim().replace(/\/+$/, '')
  const modelAnswer = (await ask(`[2/3] 模型名称（回车 = ${config.model}）: `)).trim()
  rl.close()

  if (baseAnswer && !/^https?:\/\//.test(baseAnswer)) {
    print(`base URL 无效（需要 http(s):// 开头）：${baseAnswer}，未保存`)
    return 2
  }

  // Step 3 is the secret: raw-mode hidden read.
  const key = await readHidden('[3/3] API Key（输入不回显，Ctrl+C 取消）: ')
  if (key === undefined) {
    print('已取消')
    return 2
  }
  const trimmed = key.trim()
  if (trimmed.length < 8 || /\s/.test(trimmed)) {
    print('Key 无效（过短或含空白），未存储')
    return 2
  }

  let endpointChanged = false
  if (baseAnswer && baseAnswer !== config.apiBase) {
    config.apiBase = baseAnswer
    endpointChanged = true
  }
  if (modelAnswer && modelAnswer !== config.model) {
    config.model = modelAnswer
    config.fallbackModel = modelAnswer
    endpointChanged = true
  }
  if (endpointChanged) saveConfig(config, DEFAULT_CONFIG_PATH)

  saveApiKey(AUTO_GUARD_DIR, trimmed)
  print('')
  print(`✅ 已保存：端点 ${config.apiBase} · 模型 ${config.model} · Key ${maskKey(trimmed)}（加密落盘 api-key.json）`)
  print('立即生效（新 hook 进程自动读取）；可运行 guard ping 验证连通性')
  return 0
}

function readHidden(prompt: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    let buffer = ''
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8')
      if (char === '\r' || char === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolve(buffer)
      } else if (char === '\u0003') {
        cleanup()
        process.stdout.write('\n')
        resolve(undefined)
      } else if (char === '\u007f' || char === '\b') {
        buffer = buffer.slice(0, -1)
      } else if (char >= ' ' && char <= '~') {
        buffer += char
      }
      // Non-printable bytes are ignored; keys are ASCII.
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (invokedDirectly || process.env.AUTO_GUARD_CLI_ENTRY === '1') {
  main(process.argv.slice(2))
    .then((code) => {
      // Natural exit (not process.exit) lets libuv drain open handles — avoids
      // the UV_HANDLE_CLOSING assertion crash on Windows after fetch calls.
      process.exitCode = code
    })
    .catch((error: unknown) => {
      print(String(error instanceof Error ? error.message : error))
      process.exitCode = 1
    })
}
