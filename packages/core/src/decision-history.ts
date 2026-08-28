/**
 * Decision history: a per-host ring of recent decisions in a JSONL file.
 *
 * Gives hosts without a push channel (e.g. zcode's one-process-per-call hook)
 * a pull-based way to inspect what the guard decided (`guard recent`).
 * Purely cosmetic — failures never break a decision.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Best-effort status snapshot for one decided tool call. */
export interface RuntimeStatus {
  lastRunAt?: string
  lastTool?: string
  /** Guarded subject for `guard recent`: the bash command or file path (single line). */
  lastCommand?: string
  lastDecisionKind?: string
  lastDecisionSource?: string
  lastRisk?: string
  lastDetail?: string
  reviewerLastFailed?: boolean
}

/** Append one decision to the ring history (trimmed on read). */
export function appendDecisionHistory(entry: RuntimeStatus, path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
  } catch {
    // History is cosmetic; never let it break a decision.
  }
}

/** Read the last `count` decisions, oldest first. */
export function readRecentDecisions(count: number, path: string): RuntimeStatus[] {
  try {
    const raw = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    return raw.slice(-count).map((line) => {
      try {
        return JSON.parse(line) as RuntimeStatus
      } catch {
        return {}
      }
    })
  } catch {
    return []
  }
}

/** Local 24h `MM-DD HH:mm:ss` for display; `lastRunAt` is stored as UTC ISO. */
export function formatLocalTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Collapse to one line and cap length for single-column display. */
export function truncateOneLine(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, Math.max(0, maxChars - 1))}…`
}
