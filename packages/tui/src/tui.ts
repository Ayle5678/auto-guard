#!/usr/bin/env node
/**
 * `auto-guard-tui` bin entry (SPEC 0009): TTY guard → driver → main loop.
 *
 * Windows discipline: natural exit via `process.exitCode` (never
 * `process.exit()`), letting libuv drain; the reviewer transport is
 * one-shot (grill-log Round 7) so no keep-alive handles can dangle.
 * Terminal restore is idempotent and registered on process 'exit'.
 */
import { initialState, reduce, render } from './app.ts'
import { execRun, loadRootSummaries, saveWizard } from './actions.ts'
import { assertInteractive, Terminal } from './term.ts'
import { t } from './i18n.ts'
import type { AppEvent, Effect, Receipt } from './types.ts'
import type { Lang } from '@auto-guard/core'

let receiptSeq = 1
let quitting = false

function baseLang(): Lang {
  return process.env.AUTO_GUARD_LANG === 'en' ? 'en' : 'zh'
}

async function main(): Promise<number> {
  const refuse = assertInteractive(process.stdin, process.env)
  if (refuse) {
    process.stdout.write(`${t(baseLang(), refuse === 'notATty' ? 'notATty' : 'dumbTerm')}\n`)
    return 2
  }
  const colorEnabled = !process.env.NO_COLOR
  let state = initialState({ width: process.stdout.columns || 80, height: process.stdout.rows || 24 })
  let term: Terminal
  let painting = false

  const paint = (): void => {
    if (painting || quitting || !term) return
    painting = true
    try {
      term.paint(render(state))
    } finally {
      painting = false
    }
  }

  const dispatch = (event: AppEvent): void => {
    const result = reduce(state, event)
    state = result.state
    paint()
    void runEffects(result.effects)
  }

  const quit = (): void => {
    if (quitting) return
    quitting = true
    term?.restore()
    process.stdin.pause()
    process.exitCode = 0
  }

  const runEffects = async (effects: readonly Effect[]): Promise<void> => {
    for (const effect of effects) {
      if (quitting) return
      if (effect.type === 'quit') {
        quit()
        return
      }
      if (effect.type === 'refresh') {
        dispatch({ type: 'roots', roots: loadRootSummaries(), machineLangResolved: true })
        continue
      }
      if (effect.type === 'run') {
        dispatch({ type: 'busy-start', run: effect.run })
        const receipt = await execRun({}, effect.run, state.currentRoot, receiptSeq++)
        dispatch({ type: 'run-done', receipt })
        continue
      }
      // set-key wizard: the unified CLI branch refuses (documented gap), so
      // the save goes through core ops directly (ADR-0014 decision 3).
      if (effect.type === 'wizard') {
        const label = 'set set-key (wizard)'
        dispatch({ type: 'busy-start', run: { kind: 'mgmt', argv: ['set', 'set-key'], label } })
        saveWizard(state.currentRoot, effect.input, state.lang)
        const receipt: Receipt = { id: receiptSeq++, argv: label, code: 0, output: [t(state.lang, 'wizSaved')] }
        dispatch({ type: 'run-done', receipt })
      }
    }
  }

  term = new Terminal(process.stdin, process.stdout, {
    colorEnabled,
    onKey: (key) => {
      if (!quitting) dispatch({ type: 'key', key })
    },
    onResize: () => {
      if (!quitting) dispatch({ type: 'resized', width: term.width, height: term.height })
    },
  })
  process.on('exit', () => term.restore())
  term.enter()
  paint()
  return await new Promise<number>((resolve) => {
    const poll = setInterval(() => {
      if (state.busy) dispatch({ type: 'tick' })
      if (quitting) {
        clearInterval(poll)
        resolve(0)
      }
    }, 150)
    poll.unref?.()
  })
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
