/**
 * Reviewer output parsing (ADR-0020): the compact verdict code (`A1`,
 * `B3: …`) first, with the historical three-key JSON shape as a fallback
 * for models that ignore the code instruction. Dependency-free so it is
 * testable without a Pi runtime or network.
 */
import type { LlmReviewResult, RiskLevel } from './types.ts'

const VALID_DECISIONS = new Set(['allow', 'deny', 'ask'])
const VALID_RISKS = new Set(['low', 'medium', 'high'])

/** `A1`–`C3` verdict code: letter = decision, digit = risk, optional `: reason` (half/full-width colon; reason may be absent). */
const VERDICT_CODE = /^([abc])([123])\s*(?:[:：]\s*(.*\S)?)?\s*[.。]?\s*$/i
const CODE_DECISIONS = { A: 'allow', B: 'deny', C: 'ask' } as const
const CODE_RISKS = { '1': 'low', '2': 'medium', '3': 'high' } as const

/** Parse a compact verdict-code reply; `undefined` when the text is not a code. */
function parseVerdictCode(trimmed: string): LlmReviewResult | undefined {
  const match = VERDICT_CODE.exec(trimmed)
  if (!match) return undefined
  return {
    decision: CODE_DECISIONS[match[1]!.toUpperCase() as keyof typeof CODE_DECISIONS],
    risk: CODE_RISKS[match[2] as keyof typeof CODE_RISKS],
    reason: match[3] ?? '',
  }
}

/** Parse the historical `{"decision","risk","reason"}` JSON shape, tolerating surrounding text. */
function parseLegacyJson(trimmed: string): LlmReviewResult | undefined {
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

/** Extract and validate a review result from an LLM text reply: verdict code first, strict-JSON fallback. */
export function parseReviewJson(text: string): LlmReviewResult | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  return parseVerdictCode(trimmed) ?? parseLegacyJson(trimmed)
}
