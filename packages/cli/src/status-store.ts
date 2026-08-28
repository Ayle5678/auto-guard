/**
 * Per-config-root status and decision-history reads for the CLI. Pure file
 * reads with cosmetic-failure semantics: missing or corrupt files read as
 * empty.
 */
import { readFileSync } from 'node:fs'
import { readRecentDecisions as readCore, type RuntimeStatus } from '@auto-guard/core'

export type { RuntimeStatus }

/** Read the last `count` decisions from `<root>/decision-history.jsonl`, oldest first. */
export function readRecentDecisions(count: number, path: string): RuntimeStatus[] {
  return readCore(count, path)
}

/** Best-effort status snapshot stored by the host hook at `<root>/status.json`. */
export function readStatus(path: string): RuntimeStatus {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RuntimeStatus
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
