/**
 * Persisted state for learned-rule analysis.
 *
 * Both manual and automatic analyses update the same `lastAnalysisAt`
 * timestamp so an automatic run never fires shortly after a manual one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AnalyzeState {
  lastAnalysisAt?: string
}

export function loadAnalyzeState(path: string): AnalyzeState {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AnalyzeState>
    if (parsed && typeof parsed === 'object' && typeof parsed.lastAnalysisAt === 'string') {
      return { lastAnalysisAt: parsed.lastAnalysisAt }
    }
    return {}
  } catch {
    return {}
  }
}

export function saveAnalyzeState(path: string, state: AnalyzeState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' })
}

export function updateLastAnalysis(path: string, at: Date = new Date()): AnalyzeState {
  const state = loadAnalyzeState(path)
  state.lastAnalysisAt = at.toISOString()
  saveAnalyzeState(path, state)
  return state
}

/** Interval in ms: `analyzeIntervalMinutes` wins when > 0, else the day-based fallback. */
export function analysisIntervalMs(config: { analyzeIntervalMinutes: number; analyzeIntervalDays: number }): number {
  if (config.analyzeIntervalMinutes > 0) return config.analyzeIntervalMinutes * 60 * 1000
  return config.analyzeIntervalDays * 24 * 60 * 60 * 1000
}

export function shouldRunAutoAnalysis(state: AnalyzeState, intervalMs: number, now: Date = new Date()): boolean {
  if (!state.lastAnalysisAt) return true
  const last = new Date(state.lastAnalysisAt).getTime()
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= intervalMs
}
