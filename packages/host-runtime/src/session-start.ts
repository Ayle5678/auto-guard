/**
 * Shared SessionStart hook entry (ADR-0016) — hosts fire it on
 * `startup` / `resume` (opencode has no session hook and simply never wires
 * `sessionMain`).
 *
 * Two best-effort jobs, both fail-open (session start must never be blocked):
 *  1. prune session state directories idle for over a day;
 *  2. when enabled, run learned-rule analysis on the interval schedule
 *     (async, detached so the hook returns immediately).
 */
import { spawn } from 'node:child_process'
import { analysisIntervalMs, loadAnalyzeState, shouldRunAutoAnalysis, pruneSessions, sessionsRoot } from '@auto-guard/core'
import { dirname, join } from 'node:path'
import type { HostConfigSpace } from './config.ts'

export interface SessionMainOptions {
  /** Detached analysis spawn (injectable for tests). */
  spawnAnalysis?(command: string, args: readonly string[]): unknown
  /** Where the sibling management CLI lives (defaults to the running entry's directory). */
  here?(): string
}

export function createSessionMain(space: HostConfigSpace): (options?: SessionMainOptions) => void {
  return function sessionMain(options: SessionMainOptions = {}): void {
    let config
    try {
      config = space.loadConfig()
    } catch {
      process.exit(0)
    }
    try {
      pruneSessions(sessionsRoot(space.autoGuardDir))
    } catch {
      // Best-effort housekeeping.
    }
    try {
      if (
        config.examineEnabled &&
        config.autoAnalyzeEnabled &&
        shouldRunAutoAnalysis(loadAnalyzeState(config.analyzeStatePath), analysisIntervalMs(config))
      ) {
        const here = options.here?.() ?? entryDir()
        if (options.spawnAnalysis) {
          options.spawnAnalysis(process.execPath, [join(here, 'cli.js'), 'optimize', 'analyze'])
        } else {
          const child = spawn(process.execPath, [join(here, 'cli.js'), 'optimize', 'analyze'], {
            detached: true,
            stdio: 'ignore',
          })
          child.unref()
        }
      }
    } catch {
      // Analysis is opportunistic; ignore.
    }
    process.exit(0)
  }
}

function entryDir(): string {
  // The running entry is the host facade's dist session-start.js, so the
  // management CLI sits next to it.
  const entry = process.argv[1]
  return entry ? dirname(entry) : dirname(join('.', 'cli.js'))
}
