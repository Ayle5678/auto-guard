#!/usr/bin/env node
/**
 * SessionStart hook entry — Qoder fires it on session start / resume
 * (matcher `startup|resume`, the claude precedent; the exact value set is
 * pending live-session verification, see spec 0005 ticket 01 — compact/clear
 * stay unhooked on purpose either way).
 *
 * Two best-effort jobs, both fail-open (session start must never be blocked):
 *  1. prune session state directories idle for over a day;
 *  2. when enabled, run learned-rule analysis on the interval schedule
 *     (async, detached so the hook returns immediately).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfig, AUTO_GUARD_DIR } from './config.ts'
import { analysisIntervalMs, loadAnalyzeState, shouldRunAutoAnalysis, pruneSessions, sessionsRoot } from '@auto-guard/core'

function main(): void {
  let config
  try {
    config = loadConfig()
  } catch {
    process.exit(0)
  }
  try {
    pruneSessions(sessionsRoot(AUTO_GUARD_DIR))
  } catch {
    // Best-effort housekeeping.
  }
  try {
    if (
      config.examineEnabled &&
      config.autoAnalyzeEnabled &&
      shouldRunAutoAnalysis(loadAnalyzeState(config.analyzeStatePath), analysisIntervalMs(config))
    ) {
      const here = dirname(fileURLToPath(import.meta.url))
      const child = spawn(process.execPath, [join(here, 'cli.js'), 'optimize', 'analyze'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    }
  } catch {
    // Analysis is opportunistic; ignore.
  }
  process.exit(0)
}

main()
