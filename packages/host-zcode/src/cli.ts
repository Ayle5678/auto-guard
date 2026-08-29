#!/usr/bin/env node
/**
 * Management CLI for the ZCode plugin — thin terminal rendering over the
 * shared core operations layer (ADR-0009).
 *
 * Secret handling: API keys are never accepted as argv (shell history would
 * capture them). `set set-key` reads the key from a TTY with echo disabled and
 * stores it AES-GCM-encrypted (core key-store); the env var remains primary.
 *
 * Output language follows the four-layer resolution (ADR-0011): env >
 * config.lang > machine default > zh, resolved per command after its config
 * load (one command per process, so effectively once per process).
 *
 * Usage: node dist/cli.js <group> <action> [args]
 */
import { createInterface } from 'node:readline'
import {
  analysisIntervalMs,
  clearApiKey,
  coreMessage,
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
  resolveProcessLang,
  saveApiKey,
  analyzeLearnedRules,
  applyHistoryToggle,
  applySetApi,
  applySetLang,
  examineStatusLines,
  optimizeListLines,
  optimizeStatusLines,
  recentLines,
  reportLines,
  rollbackLearnedRules,
  setEnabled,
  statusLines,
  updateLastAnalysis,
} from '@auto-guard/core'
import type { Lang } from '@auto-guard/core'
import { AUTO_GUARD_DIR, DEFAULT_CONFIG_PATH, defaultConfig, loadConfig, saveConfig } from './config.ts'
import { appendDecisionHistory, bootstrap, readRecentDecisions, readStatus } from './bootstrap.ts'
import { zcMessage } from './messages.ts'

function print(message: string): void {
  process.stdout.write(`${message}\n`)
}

/** Four-layer language resolution (env > config.lang > machine default > zh), once per command. */
function resolveLang(configLang?: Lang): Lang {
  return resolveProcessLang(configLang)
}

/** CLI entry (exported for tests; argv excludes the binary name). */
export async function main(argv: readonly string[]): Promise<number> {
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
      print(zcMessage(resolveLang(), 'usage'))
      return 1
  }
}

function auditFor(config: ReturnType<typeof loadConfig>) {
  return createAuditStore(config.auditDbPath, loadAuditPassword(AUTO_GUARD_DIR))
}

function guardCommand(action: string, rest: readonly string[] = []): number | Promise<number> {
  // Read-only group: hydrate the encrypted key so status/ping see it.
  const config = hydrateApiKey(loadConfig(), () => loadApiKey(AUTO_GUARD_DIR))
  const lang = resolveLang(config.lang)
  switch (action) {
    case 'on':
    case 'off': {
      print(setEnabled(config, action === 'on', lang))
      saveConfig(config, DEFAULT_CONFIG_PATH)
      return 0
    }
    case 'status': {
      print(statusLines(config, readStatus(), `${AUTO_GUARD_DIR}/config.json`, undefined, lang).join('\n'))
      return 0
    }
    case 'stats': {
      if (config.examineEnabled) {
        const audit = auditFor(config)
        try {
          print(zcMessage(lang, 'statsAuditCount', { count: audit.count() }))
        } finally {
          audit.close()
        }
      } else {
        print(zcMessage(lang, 'statsExamineOff'))
      }
      return 0
    }
    case 'report': {
      const days = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : 7
      if (!config.examineEnabled) {
        print(zcMessage(lang, 'statsExamineOff'))
        return 0
      }
      const audit = auditFor(config)
      try {
        print(reportLines(audit.summarizeSince(days), days, lang).join('\n'))
      } finally {
        audit.close()
      }
      return 0
    }
    case 'recent': {
      const count = Number(rest[0]) > 0 ? Number(rest[0]) : 10
      print(recentLines(readRecentDecisions(count), count, lang).join('\n'))
      return 0
    }
    case 'ping': {
      const reviewer = new DeepSeekReviewer(config, lang)
      return reviewer.ping().then((result) => {
        print(result.ok ? zcMessage(lang, 'pingOk') : zcMessage(lang, 'pingFail', { error: result.error ?? zcMessage(lang, 'unknownError') }))
        return result.ok ? 0 : 2
      })
    }
    default:
      print(zcMessage(lang, 'guardUsage'))
      return 1
  }
}

function setCommand(action: string, rest: readonly string[]): number | Promise<number> {
  const config = loadConfig()
  const lang = resolveLang(config.lang)
  switch (action) {
    case 'set-key':
      return setKeyInteractive(config, lang)
    case 'show-key': {
      const envSet = Boolean(process.env[config.apiKeyEnv])
      print(
        [
          zcMessage(lang, envSet ? 'showKeyEnvSet' : 'showKeyEnvUnset', { name: config.apiKeyEnv }),
          hasStoredApiKey(AUTO_GUARD_DIR) ? zcMessage(lang, 'showKeyStored', { dir: AUTO_GUARD_DIR }) : zcMessage(lang, 'showKeyNoStore'),
          config.apiKey && !config.apiKey.startsWith('v1:')
            ? zcMessage(lang, 'showKeyLegacy', { key: maskKey(config.apiKey) })
            : zcMessage(lang, 'showKeyNoLegacy'),
        ].join('\n'),
      )
      return 0
    }
    case 'clear-key': {
      clearApiKey(AUTO_GUARD_DIR)
      print(zcMessage(lang, 'clearKeyDone'))
      return 0
    }
    case 'set-api': {
      const [sub, value] = rest
      const result = applySetApi(config, sub, value, defaultConfig(), lang)
      if (result.ok) saveConfig(config, DEFAULT_CONFIG_PATH)
      print(result.message)
      return result.ok ? 0 : 1
    }
    case 'lang': {
      const result = applySetLang(config, rest[0])
      if (!result.ok || !result.lang) {
        print(zcMessage(lang, 'setLangInvalid', { value: rest[0] ?? '' }))
        return 1
      }
      saveConfig(config, DEFAULT_CONFIG_PATH)
      // Receipt in the newly selected language: immediate proof the setting took effect.
      print(zcMessage(result.lang, 'setLangDone', { lang: result.lang }))
      return 0
    }
    case 'history': {
      const result = applyHistoryToggle(config, rest[0], lang)
      if (result.ok) saveConfig(config, DEFAULT_CONFIG_PATH)
      print(result.messages.join('\n'))
      return result.ok ? 0 : 1
    }
    case 'reload':
      // Kept for muscle-memory parity; hooks re-read on every process.
      loadConfig()
      print(zcMessage(lang, 'reloadNote'))
      return 0
    default:
      print(zcMessage(lang, 'setUsage'))
      return 1
  }
}

function examineCommand(action: string): number {
  const config = loadConfig()
  const lang = resolveLang(config.lang)
  switch (action) {
    case 'on': {
      config.examineEnabled = true
      saveConfig(config, DEFAULT_CONFIG_PATH)
      print(zcMessage(lang, 'examineOn'))
      return 0
    }
    case 'off': {
      config.examineEnabled = false
      saveConfig(config, DEFAULT_CONFIG_PATH)
      print(zcMessage(lang, 'examineOff'))
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
          print(zcMessage(lang, 'examineClearedOld', { count: audit.clearOld(30) }))
        } else {
          audit.clearAll()
          print(zcMessage(lang, 'examineClearedAll'))
        }
      } finally {
        audit.close()
      }
      return 0
    }
    default:
      print(zcMessage(lang, 'examineUsage'))
      return 1
  }
}

function optimizeCommand(action: string): number {
  const config = loadConfig()
  const lang = resolveLang(config.lang)
  switch (action) {
    case 'status': {
      print(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt, lang).join('\n'))
      return 0
    }
    case 'analyze': {
      const runtime = bootstrap()
      try {
        const result = analyzeLearnedRules({ config: runtime.config, rules: runtime.rules, audit: runtime.audit }, lang)
        print(result.message)
        if (result.ok) updateLastAnalysis(config.analyzeStatePath)
        return result.ok ? 0 : 2
      } finally {
        runtime.audit.close()
      }
    }
    case 'auto': {
      print(zcMessage(lang, 'optimizeAutoUnsupported'))
      return 1
    }
    case 'list': {
      print(optimizeListLines(loadLearnedRules(config.learnedRulesPath), lang).join('\n'))
      return 0
    }
    case 'rollback': {
      const result = rollbackLearnedRules(config, lang)
      print(result.message)
      return result.ok ? 0 : 2
    }
    default:
      print(zcMessage(lang, 'optimizeUsage'))
      return 1
  }
}

/**
 * Interactive `set set-key`: a three-step wizard — review endpoint base URL,
 * model name, then the API key (echo disabled). Each step accepts Enter to
 * keep the current value. The key never passes through argv or the chat.
 */
async function setKeyInteractive(config: ReturnType<typeof loadConfig>, lang: Lang): Promise<number> {
  if (!process.stdin.isTTY) {
    print(zcMessage(lang, 'setKeyNeedsTty'))
    return 2
  }
  if (process.env[config.apiKeyEnv]) {
    print(zcMessage(lang, 'setKeyEnvWarning', { name: config.apiKeyEnv }))
  }

  // Steps 1-2 are not secrets: plain readline with echo.
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer)))
  print(zcMessage(lang, 'wizardBanner'))
  const baseAnswer = (await ask(zcMessage(lang, 'wizardBasePrompt', { base: config.apiBase }))).trim().replace(/\/+$/, '')
  const modelAnswer = (await ask(zcMessage(lang, 'wizardModelPrompt', { model: config.model }))).trim()
  rl.close()

  if (baseAnswer && !/^https?:\/\//.test(baseAnswer)) {
    print(zcMessage(lang, 'wizardInvalidBase', { value: baseAnswer }))
    return 2
  }

  // Step 3 is the secret: raw-mode hidden read.
  const key = await readHidden(zcMessage(lang, 'wizardKeyPrompt'))
  if (key === undefined) {
    print(zcMessage(lang, 'wizardCancelled'))
    return 2
  }
  const trimmed = key.trim()
  if (trimmed.length < 8 || /\s/.test(trimmed)) {
    print(zcMessage(lang, 'wizardInvalidKey'))
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
  print(zcMessage(lang, 'wizardSaved', { base: config.apiBase, model: config.model, key: maskKey(trimmed) }))
  print(zcMessage(lang, 'wizardSavedHint'))
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
