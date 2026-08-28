/**
 * Auto Guard Typert Remote manifest.
 *
 * Exposed as `./typert` so the DSH Typert loader can register the `autoGuard`
 * namespace without importing protocol internals in the plugin entry. The
 * server-side service object is provided via `ctx.provide('autoGuard', ...)`
 * and carries the `typertRemote` property (cost-meter pattern).
 */
import { z } from 'zod'

const patternRuleSchema = z.object({
  pattern: z.string(),
  reason: z.string().optional(),
})

const learnedRulesSchema = z.object({
  version: z.literal(1),
  cacheable: z.array(patternRuleSchema),
})

const okMessageSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
})

const listRulesSchema = z.object({
  version: z.literal(1),
  cacheable: z.array(patternRuleSchema),
})

const statusSchema = z.object({
  examineEnabled: z.boolean(),
  historyEnabled: z.boolean(),
  autoAnalyzeEnabled: z.boolean(),
  lastAnalysisAt: z.string().nullable(),
  cacheableCount: z.number(),
})

const clearOldSchema = z.object({
  removed: z.number(),
})

const clearAllSchema = z.object({
  ok: z.boolean(),
})

const statsSchema = z.object({
  llmCalls: z.number(),
  sessionCacheHits: z.number(),
  persistentCacheHits: z.number(),
  historyHits: z.number(),
  learnedHits: z.number(),
  ruleHits: z.record(z.string(), z.number()),
})

const codec = (typeSymbol: string, schema: z.ZodType) => ({ mode: 'strict', typeSymbol, schema })

const invocations = [
  {
    id: 'dsh-auto-guard#autoGuard/analyzeNow',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'analyzeNow',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#OkMessage', okMessageSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/listRules',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'listRules',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#ListRules', listRulesSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/rollback',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'rollback',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#OkMessage', okMessageSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/status',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#Status', statusSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/clearOld',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'clearOld',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#ClearOld', clearOldSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/clearAll',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'clearAll',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#ClearAll', clearAllSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/exportPlaintext',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'exportPlaintext',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#OkMessage', okMessageSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/createNewAudit',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'createNewAudit',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#OkMessage', okMessageSchema),
  },
  {
    id: 'dsh-auto-guard#autoGuard/stats',
    service: 'autoGuard',
    namespace: 'autoGuard',
    method: 'stats',
    invocation: { kind: 'direct' },
    parameters: [],
    result: codec('dsh-auto-guard#Stats', statsSchema),
  },
]

const members = [
  { kind: 'method', name: 'analyzeNow', signature: 'analyzeNow(): Promise<{ok: boolean; message: string}>' },
  { kind: 'method', name: 'listRules', signature: 'listRules(): LearnedRulesFile' },
  { kind: 'method', name: 'rollback', signature: 'rollback(): {ok: boolean; message: string}' },
  { kind: 'method', name: 'status', signature: 'status(): Status' },
  { kind: 'method', name: 'clearOld', signature: 'clearOld(): {removed: number}' },
  { kind: 'method', name: 'clearAll', signature: 'clearAll(): {ok: boolean}' },
  { kind: 'method', name: 'exportPlaintext', signature: 'exportPlaintext(): {ok: boolean; message: string}' },
  { kind: 'method', name: 'createNewAudit', signature: 'createNewAudit(): {ok: boolean; message: string}' },
  { kind: 'method', name: 'stats', signature: 'stats(): GuardStats' },
]

export const TYPERT = {
  package: 'dsh-auto-guard',
  face: 'host',
  schemas: [],
  invocations,
  model: {
    services: [
      {
        key: 'autoGuard',
        exportName: 'AutoGuardRemote',
        description: 'DSH Auto Guard maintenance actions for the settings page.',
        tags: [],
        members,
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
