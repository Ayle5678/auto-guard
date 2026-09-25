import { describe, expect, it } from 'vitest'
import { recordToolCallAudit, resolveNotify, translateDecision } from '../src/host-policy.ts'
import type { AuditRecordInput, AuditStore } from '../src/audit.ts'
import type { Decision, GuardConfig, GuardRequest, RulesFile } from '../src/types.ts'

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'allow', source: 'llm', reason: 'ok', ...overrides }
}

const rules: RulesFile = {
  version: 1,
  staticAllow: [{ pattern: 'npm run build *' }],
  hardDeny: [],
  directoryDelete: [],
  directoryDeleteGuards: [],
  userConfirmed: [],
  cacheable: [],
  alwaysReview: [],
  staticAllowGuards: [],
  sensitivePaths: [],
}

const notifyConfig = (overrides: Partial<Pick<GuardConfig, 'notifyCacheHit' | 'notifyLlmDecision' | 'notifyAllow' | 'notifyDeny' | 'notifyAsk'>> = {}): Pick<GuardConfig, 'notifyCacheHit' | 'notifyLlmDecision' | 'notifyAllow' | 'notifyDeny' | 'notifyAsk'> => ({
  notifyCacheHit: true,
  notifyLlmDecision: true,
  notifyAllow: 'page',
  notifyDeny: 'context',
  notifyAsk: 'context',
  ...overrides,
})

const bothChannels = { notifyChannels: { page: true, context: true } }
const pageOnly = { notifyChannels: { page: true, context: false } }
const noChannels = { notifyChannels: { page: false, context: false } }

describe('translateDecision', () => {
  const native = { askStyle: 'native', hasUI: false } as const
  const dsh = { askStyle: 'one-shot', hasUI: true } as const
  const codex = { askStyle: 'one-shot', hasUI: false } as const

  it('first directory-delete hit denies and asks for a retry marker', () => {
    const t = translateDecision(decision({ kind: 'deny', source: 'directory-delete', needsReason: true, reason: '需要理由' }), native)
    expect(t).toEqual({ action: 'deny', reason: '需要理由', needsReason: true, needsHumanVeto: false, vetoTitleKey: undefined })
  })

  it('non-allowed directory deletions hand the final say to the human', () => {
    const t = translateDecision(decision({ kind: 'deny', source: 'directory-delete', reviewerFailed: true }), native)
    expect(t.action).toBe('ask')
    expect(t.needsHumanVeto).toBe(true)
    expect(t.vetoTitleKey).toBe('deleteFailReviewerTitle')

    const llm = translateDecision(decision({ kind: 'ask', source: 'directory-delete' }), native)
    expect(llm.action).toBe('ask')
    expect(llm.needsHumanVeto).toBe(true)
    expect(llm.vetoTitleKey).toBe('deleteFailLlmTitle')
  })

  it('a one-shot host with its own approval UI keeps a plain ask for an LLM ask on a directory deletion', () => {
    const t = translateDecision(decision({ kind: 'ask', source: 'directory-delete' }), dsh)
    expect(t).toEqual({ action: 'ask', reason: 'ok', needsReason: false, needsHumanVeto: false, vetoTitleKey: undefined })
    // A flat deny still escalates to the human veto.
    expect(translateDecision(decision({ kind: 'deny', source: 'directory-delete' }), dsh).needsHumanVeto).toBe(true)
  })

  it('a one-shot host without a UI (wire-translated asks) still escalates the veto', () => {
    const t = translateDecision(decision({ kind: 'ask', source: 'directory-delete' }), codex)
    expect(t.needsHumanVeto).toBe(true)
    expect(t.vetoTitleKey).toBe('deleteFailLlmTitle')
  })

  it('an allowed directory deletion is a plain allow', () => {
    const t = translateDecision(decision({ kind: 'allow', source: 'directory-delete' }), native)
    expect(t).toEqual({ action: 'allow', reason: 'ok', needsReason: false, needsHumanVeto: false, vetoTitleKey: undefined })
  })

  it('plain decisions map kind to action', () => {
    expect(translateDecision(decision({ kind: 'deny' }), native).action).toBe('deny')
    expect(translateDecision(decision({ kind: 'ask', source: 'llm' }), native).action).toBe('ask')
    expect(translateDecision(decision({ kind: 'allow', source: 'static-allow' }), native).action).toBe('allow')
  })
})

describe('resolveNotify', () => {
  it('gates cache-family sources on notifyCacheHit', () => {
    const d = decision({ kind: 'allow', source: 'session-cache' })
    expect(resolveNotify(d, notifyConfig(), bothChannels)).toBe('page')
    expect(resolveNotify(d, notifyConfig({ notifyCacheHit: false }), bothChannels)).toBeUndefined()
    for (const source of ['persistent-cache', 'history', 'learned'] as const) {
      expect(resolveNotify(decision({ kind: 'allow', source }), notifyConfig({ notifyCacheHit: false }), bothChannels)).toBeUndefined()
    }
  })

  it('gates llm-family sources on notifyLlmDecision', () => {
    for (const source of ['llm', 'file-tracker', 'directory-delete'] as const) {
      expect(resolveNotify(decision({ kind: 'deny', source }), notifyConfig({ notifyLlmDecision: false }), bothChannels)).toBeUndefined()
    }
  })

  it('stays silent for sources outside both families unless rule-allowed', () => {
    expect(resolveNotify(decision({ kind: 'deny', source: 'hard-deny' }), notifyConfig(), bothChannels)).toBeUndefined()
    expect(resolveNotify(decision({ kind: 'deny', source: 'sensitive-path' }), notifyConfig(), bothChannels)).toBeUndefined()
  })

  it('clamps rule-allow context routes to page (never into model context)', () => {
    const d = decision({ kind: 'allow', source: 'static-allow' })
    expect(resolveNotify(d, notifyConfig({ notifyAllow: 'context' }), bothChannels)).toBe('page')
    expect(resolveNotify(decision({ kind: 'allow', source: 'user-confirmed' }), notifyConfig({ notifyAllow: 'context' }), bothChannels)).toBe('page')
  })

  it('routes by kind and clamps to deliverable channels', () => {
    const d = decision({ kind: 'deny', source: 'llm' })
    expect(resolveNotify(d, notifyConfig(), bothChannels)).toBe('context')
    expect(resolveNotify(d, notifyConfig(), pageOnly)).toBe('page')
    expect(resolveNotify(d, notifyConfig(), noChannels)).toBeUndefined()
    expect(resolveNotify(decision({ kind: 'ask', source: 'llm' }), notifyConfig(), bothChannels)).toBe('context')
  })
})

describe('recordToolCallAudit', () => {
  function captureStore(): { store: AuditStore; inserts: AuditRecordInput[] } {
    const inserts: AuditRecordInput[] = []
    return { inserts, store: { insert: (input: AuditRecordInput) => inserts.push(input) } as unknown as AuditStore }
  }

  const request: GuardRequest = { tool: 'bash', command: 'npm run build 1', session: 's1', workspace: '/w' }

  it('writes the full record with the matched rule pattern', () => {
    const { store, inserts } = captureStore()
    recordToolCallAudit(store, rules, request, decision(), 'allow', { enabled: true, examineEnabled: true })
    expect(inserts).toEqual([
      {
        sessionId: 's1',
        workspace: '/w',
        source: 'tool_call',
        tool: 'bash',
        command: 'npm run build 1',
        decision: decision(),
        finalAction: 'allow',
        rulePattern: 'npm run build *',
      },
    ])
  })

  it('parameterizes the user_bash variant', () => {
    const { store, inserts } = captureStore()
    recordToolCallAudit(store, rules, request, decision(), 'block', { enabled: true, examineEnabled: true }, 'user_bash')
    expect(inserts[0]!.source).toBe('user_bash')
    expect(inserts[0]!.finalAction).toBe('block')
  })

  it('stays silent when the guard or audit log is off', () => {
    const { store, inserts } = captureStore()
    recordToolCallAudit(store, rules, request, decision(), 'allow', { enabled: false, examineEnabled: true })
    recordToolCallAudit(store, rules, request, decision(), 'allow', { enabled: true, examineEnabled: false })
    expect(inserts).toHaveLength(0)
  })

  it('skips file tools and non-string commands', () => {
    const { store, inserts } = captureStore()
    recordToolCallAudit(store, rules, { tool: 'write', filePath: '/w/a.ts' }, decision(), 'allow', { enabled: true, examineEnabled: true })
    recordToolCallAudit(store, rules, { tool: 'pwsh' } as GuardRequest, decision(), 'allow', { enabled: true, examineEnabled: true })
    expect(inserts).toHaveLength(0)
  })
})
