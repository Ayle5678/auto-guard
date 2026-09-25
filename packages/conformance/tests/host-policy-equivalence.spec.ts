/**
 * Three-host policy equivalence (SPEC 0022 ticket 05, ADR-0025): the decision
 * translation, the notification routing and the tool-call audit record are
 * single-sourced in core (`host-policy.ts`). This suite pins that the hook
 * runtime, pi and dsh — the three adapters that previously carried verbatim
 * copies — agree for the same decision under their real capability
 * declarations, that the veto-title key resolves to the same shared-catalog
 * wording through each host's own message lookup, and that the audit record
 * schema is byte-identical regardless of which host wrote it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore, recordToolCallAudit, resolveNotify, translateDecision, type Decision, type GuardConfig, type GuardRequest, type RulesFile } from '@auto-guard/core'
import { createHostMessage } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from '@auto-guard/host-zcode/src/descriptor.ts'
import { PI_CAPABILITIES } from '@auto-guard/host-pi/src/pi-capabilities.ts'
import { piMessage } from '@auto-guard/host-pi/src/messages.ts'
import { CODEX_CAPABILITIES } from '../../host-codex/src/codex-capabilities.ts'
import { DSH_CAPABILITIES } from '../../host-dsh/src/dsh-capabilities.ts'
import { dshMessage } from '../../host-dsh/src/messages.ts'

/** The policy owners' real declarations (hook runtime via its zcode descriptor; codex shares that runtime). */
const HOSTS = {
  hook: { capabilities: ZCODE_DESCRIPTOR.capabilities, message: createHostMessage() },
  codex: { capabilities: CODEX_CAPABILITIES },
  pi: { capabilities: PI_CAPABILITIES, message: piMessage },
  dsh: { capabilities: DSH_CAPABILITIES, message: dshMessage },
} as const

function decision(overrides: Partial<Decision> = {}): Decision {
  return { kind: 'allow', source: 'llm', reason: 'ok', ...overrides }
}

/** Every policy-relevant decision shape. */
const DECISIONS: Array<[name: string, Decision]> = [
  ['first directory-delete hit', decision({ kind: 'deny', source: 'directory-delete', needsReason: true, reason: '需要理由' })],
  ['reviewer-failed directory delete', decision({ kind: 'deny', source: 'directory-delete', reviewerFailed: true })],
  ['LLM-denied directory delete', decision({ kind: 'deny', source: 'directory-delete' })],
  ['LLM-ask directory delete', decision({ kind: 'ask', source: 'directory-delete' })],
  ['allowed directory delete', decision({ kind: 'allow', source: 'directory-delete' })],
  ['plain llm allow', decision({ kind: 'allow', source: 'llm' })],
  ['plain llm deny', decision({ kind: 'deny', source: 'llm' })],
  ['plain llm ask', decision({ kind: 'ask', source: 'llm' })],
  ['rule allow', decision({ kind: 'allow', source: 'static-allow' })],
  ['hard deny', decision({ kind: 'deny', source: 'hard-deny' })],
  ['session cache hit', decision({ kind: 'allow', source: 'session-cache' })],
  ['learned hit', decision({ kind: 'allow', source: 'learned' })],
]

describe('translateDecision: three-host equivalence (ADR-0025)', () => {
  it('pi and the hook runtime (native and one-shot-without-UI hosts) translate every decision shape identically', () => {
    for (const [name, d] of DECISIONS) {
      expect(translateDecision(d, HOSTS.pi.capabilities), name).toEqual(translateDecision(d, HOSTS.hook.capabilities))
      expect(translateDecision(d, HOSTS.codex.capabilities), name).toEqual(translateDecision(d, HOSTS.hook.capabilities))
    }
  })

  it('dsh agrees except for the documented one-shot ask fallback on directory deletes', () => {
    for (const [name, d] of DECISIONS) {
      const pi = translateDecision(d, HOSTS.pi.capabilities)
      const dsh = translateDecision(d, HOSTS.dsh.capabilities)
      if (d.source === 'directory-delete' && d.kind === 'ask') {
        // The only sanctioned divergence: one-shot hosts service the ask
        // through their own approval flow, so it stays a plain ask.
        expect(dsh.needsHumanVeto, name).toBe(false)
        expect(dsh.action).toBe('ask')
        expect(pi.needsHumanVeto, name).toBe(true)
      } else {
        expect(dsh, name).toEqual(pi)
      }
    }
  })

  it('the veto title key resolves to the same shared-catalog wording on all three hosts', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const key of ['deleteFailReviewerTitle', 'deleteFailLlmTitle'] as const) {
        const texts = [HOSTS.hook.message(lang, key), HOSTS.pi.message(lang, key), HOSTS.dsh.message(lang, key)]
        expect(new Set(texts).size, `${lang}/${key}`).toBe(1)
        expect(texts[0]!.length, `${lang}/${key} wording should not be empty`).toBeGreaterThan(0)
      }
    }
  })
})

describe('resolveNotify: three-host equivalence (ADR-0025)', () => {
  const notifyConfig = (overrides: Partial<Pick<GuardConfig, 'notifyCacheHit' | 'notifyLlmDecision' | 'notifyAllow' | 'notifyDeny' | 'notifyAsk'>> = {}): Pick<GuardConfig, 'notifyCacheHit' | 'notifyLlmDecision' | 'notifyAllow' | 'notifyDeny' | 'notifyAsk'> => ({
    notifyCacheHit: true,
    notifyLlmDecision: true,
    notifyAllow: 'page',
    notifyDeny: 'context',
    notifyAsk: 'context',
    ...overrides,
  })

  it('pi and dsh (identical channel capabilities) route every decision identically', () => {
    const configs = [
      notifyConfig(),
      notifyConfig({ notifyCacheHit: false }),
      notifyConfig({ notifyLlmDecision: false }),
      notifyConfig({ notifyAllow: 'context' }),
      notifyConfig({ notifyDeny: 'off' }),
      notifyConfig({ notifyAsk: 'page' }),
    ]
    for (const [name, d] of DECISIONS) {
      for (const [ci, config] of configs.entries()) {
        expect(resolveNotify(d, config, HOSTS.dsh.capabilities), `${name}#${ci}`).toEqual(resolveNotify(d, config, HOSTS.pi.capabilities))
      }
    }
  })

  it('hook hosts without notification channels stay silent for every decision', () => {
    for (const [name, d] of DECISIONS) {
      expect(resolveNotify(d, notifyConfig(), HOSTS.hook.capabilities), name).toBeUndefined()
    }
  })
})

describe('recordToolCallAudit: record schema across hosts (ADR-0025)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

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

  const request: GuardRequest = { tool: 'bash', command: 'npm run build 7', session: 's-1', workspace: '/repo' }
  const d = decision({ kind: 'deny', reason: 'risky' })
  const gates = { enabled: true, examineEnabled: true }

  it('writes byte-identical rows regardless of the writing host; source absorbs the user_bash variant', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-policy-audit-'))
    dirs.push(dir)
    const audit = new LightAuditStore(join(dir, 'audit.db'))
    try {
      // Each "host" writes one row: hook (tool_call), pi tool_call + pi user_bash, dsh (tool_call).
      recordToolCallAudit(audit, rules, request, d, 'block', gates)
      recordToolCallAudit(audit, rules, request, d, 'block', gates)
      recordToolCallAudit(audit, rules, request, d, 'block', gates, 'user_bash')
      recordToolCallAudit(audit, rules, request, d, 'block', gates)

      const rows = audit.list()
      expect(rows).toHaveLength(4)
      for (const row of rows) {
        expect(row.session_id).toBe('s-1')
        expect(row.workspace).toBe('/repo')
        expect(row.tool).toBe('bash')
        expect(row.command).toBe('npm run build 7')
        expect(row.rule_pattern).toBe('npm run build *')
        expect(row.decision_kind).toBe('deny')
        expect(row.decision_source).toBe('llm')
        expect(row.final_action).toBe('block')
      }
      expect(rows.map((r) => r.source)).toEqual(['tool_call', 'tool_call', 'user_bash', 'tool_call'])
    } finally {
      audit.close()
    }
  })
})
