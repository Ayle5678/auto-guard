import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAnalyzeState, analysisIntervalMs, saveAnalyzeState, shouldRunAutoAnalysis, updateLastAnalysis } from '../src/analyze-state.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pi-guard-state-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('analyze-state', () => {
  it('returns empty state when the file is missing', () => {
    expect(loadAnalyzeState(join(tmp(), 'missing.json'))).toEqual({})
  })

  it('saves and reloads lastAnalysisAt', () => {
    const path = join(tmp(), 'state.json')
    saveAnalyzeState(path, { lastAnalysisAt: '2026-08-24T00:00:00.000Z' })
    expect(loadAnalyzeState(path)).toEqual({ lastAnalysisAt: '2026-08-24T00:00:00.000Z' })
  })

  it('updateLastAnalysis writes a timestamp', () => {
    const path = join(tmp(), 'state.json')
    updateLastAnalysis(path, new Date('2026-08-24T00:00:00.000Z'))
    expect(loadAnalyzeState(path).lastAnalysisAt).toBe('2026-08-24T00:00:00.000Z')
  })

  it('runs when no analysis has happened before', () => {
    expect(shouldRunAutoAnalysis({}, 15 * 24 * 60 * 60 * 1000)).toBe(true)
  })

  it('waits the full interval after the last analysis', () => {
    const path = join(tmp(), 'state.json')
    updateLastAnalysis(path, new Date('2026-08-01T00:00:00.000Z'))
    const state = loadAnalyzeState(path)
    const fifteenDays = 15 * 24 * 60 * 60 * 1000
    expect(shouldRunAutoAnalysis(state, fifteenDays, new Date('2026-08-10T00:00:00.000Z'))).toBe(false)
    expect(shouldRunAutoAnalysis(state, fifteenDays, new Date('2026-08-16T00:00:00.000Z'))).toBe(true)
  })

  it('honors a minute-level interval', () => {
    const path = join(tmp(), 'state.json')
    updateLastAnalysis(path, new Date('2026-08-01T00:00:00.000Z'))
    const state = loadAnalyzeState(path)
    expect(shouldRunAutoAnalysis(state, 20 * 60 * 1000, new Date('2026-08-01T00:19:00.000Z'))).toBe(false)
    expect(shouldRunAutoAnalysis(state, 20 * 60 * 1000, new Date('2026-08-01T00:20:00.000Z'))).toBe(true)
  })

  it('prefers minutes over days when configured', () => {
    expect(analysisIntervalMs({ analyzeIntervalMinutes: 20, analyzeIntervalDays: 15 })).toBe(20 * 60 * 1000)
    expect(analysisIntervalMs({ analyzeIntervalMinutes: 0, analyzeIntervalDays: 15 })).toBe(15 * 24 * 60 * 60 * 1000)
  })
})
