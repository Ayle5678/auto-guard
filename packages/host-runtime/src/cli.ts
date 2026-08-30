#!/usr/bin/env node
/**
 * Shared management CLI for the hook-form hosts (ADR-0016) — thin terminal
 * rendering over the core operations layer (ADR-0009), parameterized by the
 * host descriptor's config space.
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
  createAuditStore,
  DeepSeekReviewer,
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
import type { HostConfigSpace } from './config.ts'
import type { HostBootstrapKit } from './bootstrap.ts'
import type { HostMessage } from './messages.ts'

export interface CliParts {
  space: HostConfigSpace
  kit: HostBootstrapKit
  message: HostMessage
  /** Output sink (injectable for tests); default process.stdout. */
  writeOut?: (text: string) => void
}

function printVia(write: (text: string) => void): (message: string) => void {
  return (message: string) => write(`${message}\n`)
}

/** Build the CLI entry for one host (argv excludes the binary name). */
export function createCliMain(parts: CliParts): (argv: readonly string[]) => Promise<number> {
  const { space, kit, message } = parts
  const print = printVia(parts.writeOut ?? ((text: string) => process.stdout.write(text)))

  /** Four-layer language resolution (env > config.lang > machine default > zh), once per command. */
  function resolveLang(configLang?: Lang): Lang {
    return resolveProcessLang(configLang)
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
        print(message(resolveLang(), 'usage'))
        return 1
    }
  }

  function auditFor(config: ReturnType<HostConfigSpace['loadConfig']>) {
    return createAuditStore(config.auditDbPath, loadAuditPassword(space.autoGuardDir))
  }

  function guardCommand(action: string, rest: readonly string[] = []): number | Promise<number> {
    // Read-only group: hydrate the encrypted key so status/ping see it.
    const config = hydrateApiKey(space.loadConfig(), () => loadApiKey(space.autoGuardDir))
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'on':
      case 'off': {
        print(setEnabled(config, action === 'on', lang))
        space.saveConfig(config)
        return 0
      }
      case 'status': {
        print(statusLines(config, kit.readStatus(), `${space.autoGuardDir}/config.json`, undefined, lang).join('\n'))
        return 0
      }
      case 'stats': {
        if (config.examineEnabled) {
          const audit = auditFor(config)
          try {
            print(message(lang, 'statsAuditCount', { count: audit.count() }))
          } finally {
            audit.close()
          }
        } else {
          print(message(lang, 'statsExamineOff'))
        }
        return 0
      }
      case 'report': {
        const days = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : 7
        if (!config.examineEnabled) {
          print(message(lang, 'statsExamineOff'))
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
        print(recentLines(kit.readRecentDecisions(count), count, lang).join('\n'))
        return 0
      }
      case 'ping': {
        const reviewer = new DeepSeekReviewer(config, lang)
        return reviewer.ping().then((result) => {
          print(result.ok ? message(lang, 'pingOk') : message(lang, 'pingFail', { error: result.error ?? message(lang, 'unknownError') }))
          return result.ok ? 0 : 2
        })
      }
      default:
        print(message(lang, 'guardUsage'))
        return 1
    }
  }

  function setCommand(action: string, rest: readonly string[]): number | Promise<number> {
    const config = space.loadConfig()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'set-key':
        return setKeyInteractive(config, lang)
      case 'show-key': {
        const envSet = Boolean(process.env[config.apiKeyEnv])
        print(
          [
            message(lang, envSet ? 'showKeyEnvSet' : 'showKeyEnvUnset', { name: config.apiKeyEnv }),
            hasStoredApiKey(space.autoGuardDir) ? message(lang, 'showKeyStored', { dir: space.autoGuardDir }) : message(lang, 'showKeyNoStore'),
            config.apiKey && !config.apiKey.startsWith('v1:')
              ? message(lang, 'showKeyLegacy', { key: maskKey(config.apiKey) })
              : message(lang, 'showKeyNoLegacy'),
          ].join('\n'),
        )
        return 0
      }
      case 'clear-key': {
        clearApiKey(space.autoGuardDir)
        print(message(lang, 'clearKeyDone'))
        return 0
      }
      case 'set-api': {
        const [sub, value] = rest
        const result = applySetApi(config, sub, value, space.defaultConfig(), lang)
        if (result.ok) space.saveConfig(config)
        print(result.message)
        return result.ok ? 0 : 1
      }
      case 'lang': {
        const result = applySetLang(config, rest[0])
        if (!result.ok || !result.lang) {
          print(message(lang, 'setLangInvalid', { value: rest[0] ?? '' }))
          return 1
        }
        space.saveConfig(config)
        // Receipt in the newly selected language: immediate proof the setting took effect.
        print(message(result.lang, 'setLangDone', { lang: result.lang }))
        return 0
      }
      case 'history': {
        const result = applyHistoryToggle(config, rest[0], lang)
        if (result.ok) space.saveConfig(config)
        print(result.messages.join('\n'))
        return result.ok ? 0 : 1
      }
      case 'reload':
        // Kept for muscle-memory parity; hooks re-read on every process.
        space.loadConfig()
        print(message(lang, 'reloadNote'))
        return 0
      default:
        print(message(lang, 'setUsage'))
        return 1
    }
  }

  function examineCommand(action: string): number {
    const config = space.loadConfig()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'on': {
        config.examineEnabled = true
        space.saveConfig(config)
        print(message(lang, 'examineOn'))
        return 0
      }
      case 'off': {
        config.examineEnabled = false
        space.saveConfig(config)
        print(message(lang, 'examineOff'))
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
            print(message(lang, 'examineClearedOld', { count: audit.clearOld(30) }))
          } else {
            audit.clearAll()
            print(message(lang, 'examineClearedAll'))
          }
        } finally {
          audit.close()
        }
        return 0
      }
      default:
        print(message(lang, 'examineUsage'))
        return 1
    }
  }

  function optimizeCommand(action: string): number {
    const config = space.loadConfig()
    const lang = resolveLang(config.lang)
    switch (action) {
      case 'status': {
        print(optimizeStatusLines(config, loadLearnedRules(config.learnedRulesPath), loadAnalyzeState(config.analyzeStatePath).lastAnalysisAt, lang).join('\n'))
        return 0
      }
      case 'analyze': {
        const runtime = kit.bootstrap()
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
        print(message(lang, 'optimizeAutoUnsupported'))
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
        print(message(lang, 'optimizeUsage'))
        return 1
    }
  }

  /**
   * Interactive `set set-key`: a three-step wizard — review endpoint base URL,
   * model name, then the API key (echo disabled). Each step accepts Enter to
   * keep the current value. The key never passes through argv or the chat.
   */
  async function setKeyInteractive(config: ReturnType<HostConfigSpace['loadConfig']>, lang: Lang): Promise<number> {
    if (!process.stdin.isTTY) {
      print(message(lang, 'setKeyNeedsTty'))
      return 2
    }
    if (process.env[config.apiKeyEnv]) {
      print(message(lang, 'setKeyEnvWarning', { name: config.apiKeyEnv }))
    }

    // Steps 1-2 are not secrets: plain readline with echo.
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer)))
    print(message(lang, 'wizardBanner'))
    const baseAnswer = (await ask(message(lang, 'wizardBasePrompt', { base: config.apiBase }))).trim().replace(/\/+$/, '')
    const modelAnswer = (await ask(message(lang, 'wizardModelPrompt', { model: config.model }))).trim()
    rl.close()

    if (baseAnswer && !/^https?:\/\//.test(baseAnswer)) {
      print(message(lang, 'wizardInvalidBase', { value: baseAnswer }))
      return 2
    }

    // Step 3 is the secret: raw-mode hidden read.
    const key = await readHidden(message(lang, 'wizardKeyPrompt'))
    if (key === undefined) {
      print(message(lang, 'wizardCancelled'))
      return 2
    }
    const trimmed = key.trim()
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      print(message(lang, 'wizardInvalidKey'))
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
    if (endpointChanged) space.saveConfig(config)

    saveApiKey(space.autoGuardDir, trimmed)
    print('')
    print(message(lang, 'wizardSaved', { base: config.apiBase, model: config.model, key: maskKey(trimmed) }))
    print(message(lang, 'wizardSavedHint'))
    return 0
  }

  return main
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
