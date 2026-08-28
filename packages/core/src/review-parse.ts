/**
 * Strict-JSON reviewer output parsing. Dependency-free so it is testable
 * without a Pi runtime or network.
 */
import type { LlmReviewResult, RiskLevel } from './types.ts'

const VALID_DECISIONS = new Set(['allow', 'deny', 'ask'])
const VALID_RISKS = new Set(['low', 'medium', 'high'])

/** Extract and validate a strict-JSON review result from an LLM text reply. */
export function parseReviewJson(text: string): LlmReviewResult | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const decision = typeof record.decision === 'string' ? record.decision.toLowerCase() : undefined
  const risk = typeof record.risk === 'string' ? record.risk.toLowerCase() : undefined
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!decision || !VALID_DECISIONS.has(decision)) return undefined
  const riskLevel: RiskLevel = VALID_RISKS.has(risk ?? '') ? (risk as RiskLevel) : 'medium'
  return { decision: decision as LlmReviewResult['decision'], risk: riskLevel, reason }
}
