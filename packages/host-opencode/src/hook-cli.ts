#!/usr/bin/env node
/**
 * Spawned decision entry for OpenCode Auto Guard (ADR-0011 process model).
 *
 * The plugin runs inside OpenCode's bun process; every decision spawns
 * `node dist/hook-cli.js` so the core never enters bun. Protocol:
 *   stdin  → one JSON payload {tool_name, tool_input, session_id, cwd}
 *   stdout → ALWAYS one JSON verdict {"status":"allow|deny|ask","reason"?}
 *   exit   → always 0
 *
 * Failure policy is fail-closed onto the host ask: any unexpected error
 * yields {"status":"ask"} — the plugin then does not reply and OpenCode's
 * native TUI (once / always / reject) decides. The verdict never travels as
 * a thrown error: a throw inside the plugin would surface as a tool error,
 * not a permission decision.
 */
import { prepareDeletionMarker, classifyCommand, truncateOneLine, pruneSessions, sessionsRoot, analysisIntervalMs, loadAnalyzeState, shouldRunAutoAnalysis } from '@auto-guard/core'
import type { Decision, GuardRequest, RulesFile } from '@auto-guard/core'
import { appendDecisionHistory, bootstrap, isDisabledByConfig, recordAudit, writeStatus, workspaceFromEnv, type GuardRuntime } from './bootstrap.ts'
import { AUTO_GUARD_DIR } from './config.ts'
import { decisionReasonText, hitDetail, serializeVerdict, withDeletionHint, type GuardStatus, type GuardVerdict } from './hook-output.ts'
import { normalizeHookInput, toGuardRequest } from './opencode-adapter.ts'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_STDIN_BYTES = 1_000_000

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  let data = ''
  for await (const chunk of process.stdin) {
    data += chunk
    if (data.length > MAX_STDIN_BYTES) break
  }
  return data
}

/** Emit stdout and flush before exiting so no pipe buffering truncates JSON. */
function emit(text: string): void {
  process.stdout.write(text + '\n', () => process.exit(0))
}

function failClosedAsk(reason: string): void {
  emit(serializeVerdict({ status: 'ask', reason }))
}

type FinalOutcome = GuardVerdict & {
  /** Decision metadata only relevant to status bookkeeping. */
  meta?: Pick<Decision, 'kind' | 'source' | 'risk'> & { reviewerFailed?: boolean; detail?: string }
}

/** Run the full decision pipeline; the deletion two-phase flow mirrors the claude/zcode hooks. */
async function evaluate(runtime: GuardRuntime, rawCommandRequest: GuardRequest): Promise<FinalOutcome> {
  const prepared = prepareDeletionMarker(rawCommandRequest)
  const decision = await runtime.service.decide(prepared.request)

  if (decision.source === 'directory-delete' && decision.needsReason) {
    return { status: 'deny', reason: withDeletionHint(decisionReasonText(decision)), meta: pickMeta(decision, prepared.request, runtime.rules) }
  }

  if (decision.source === 'directory-delete' && decision.kind !== 'allow') {
    const flavor = decision.reviewerFailed ? '审查器故障，本次未过审' : 'LLM 未通过本次删除'
    return {
      status: 'ask',
      reason: `🛡️ auto-guard [删除复核] ${flavor}：${decision.reason ?? '未提供详情'}。是否仍要执行，请在 OpenCode 权限框中决定。`,
      meta: pickMeta(decision, prepared.request, runtime.rules),
    }
  }

  const text = decisionReasonText(decision)
  switch (decision.kind) {
    case 'allow':
      return { status: 'allow', meta: pickMeta(decision, prepared.request, runtime.rules) }
    case 'deny':
      return { status: 'deny', reason: text, meta: pickMeta(decision, prepared.request, runtime.rules) }
    case 'ask':
      return { status: 'ask', reason: text, meta: pickMeta(decision, prepared.request, runtime.rules) }
  }
}

function pickMeta(decision: Decision, request?: GuardRequest, rules?: RulesFile) {
  let pattern: string | undefined
  if (
    (decision.source === 'static-allow' || decision.source === 'user-confirmed') &&
    (request?.tool === 'bash' || request?.tool === 'pwsh') &&
    typeof request?.command === 'string' &&
    rules
  ) {
    pattern = classifyCommand(request.command, rules).rule?.pattern
  }
  return {
    kind: decision.kind,
    source: decision.source,
    risk: decision.risk,
    reviewerFailed: decision.reviewerFailed === true ? true : undefined,
    detail: hitDetail(decision, pattern),
  }
}

async function main(): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await readStdin())
  } catch {
    failClosedAsk('auto-guard：无法解析 hook 输入（stdin 不是合法 JSON），保守起见需要人工确认')
    return
  }
  const input = normalizeHookInput(raw)

  // Master switch short-circuit — happens before anything can throw.
  try {
    if (isDisabledByConfig()) {
      emit(serializeVerdict({ status: 'allow' }))
      return
    }
  } catch {
    emit(serializeVerdict({ status: 'allow' }))
    return
  }

  let runtime: GuardRuntime
  try {
    runtime = bootstrap()
    if (!runtime.config.enabled) {
      emit(serializeVerdict({ status: 'allow' }))
      return
    }
  } catch (error) {
    failClosedAsk(`auto-guard 初始化失败（检查 ~/.config/opencode/auto-guard/config.json）：${errorMessage(error)}；保守起见需要人工确认`)
    return
  }

  const extraction = toGuardRequest(input, workspaceFromEnv())

  let outcome: FinalOutcome
  if (extraction.kind === 'passthrough') {
    outcome = { status: 'allow' }
  } else if (extraction.kind === 'unreviewable') {
    outcome = { status: 'ask', reason: extraction.reason }
  } else {
    try {
      outcome = await evaluate(runtime, extraction.request)
    } catch (error) {
      outcome = { status: 'ask', reason: `auto-guard 裁决过程异常：${errorMessage(error)}；保守起见需要人工确认` }
    }
  }

  try {
    if (extraction.kind === 'guardable') {
      recordAudit(
        runtime,
        extraction.request,
        {
          kind: outcome.meta?.kind ?? (outcome.status === 'allow' ? 'allow' : 'ask'),
          source: outcome.meta?.source ?? 'error',
          risk: outcome.meta?.risk,
          reviewerFailed: outcome.meta?.reviewerFailed,
          reason: outcome.status === 'allow' ? undefined : outcome.reason,
        },
        outcome.status === 'allow' ? 'allow' : 'block',
      )
    }
    const entry = {
      lastRunAt: new Date().toISOString(),
      lastTool: input.tool_name,
      lastCommand: historySubject(input),
      lastDecisionKind: (outcome.meta?.kind ?? outcome.status) as Decision['kind'] | GuardStatus,
      lastDecisionSource: outcome.meta?.source,
      lastRisk: outcome.meta?.risk,
      lastDetail: outcome.meta?.detail ?? (outcome.status === 'allow' ? '直通/放行' : (outcome.reason ?? '').slice(0, 120)),
      reviewerLastFailed: outcome.meta?.reviewerFailed,
    }
    writeStatus(entry)
    appendDecisionHistory(entry)
    pruneSessions(sessionsRoot(AUTO_GUARD_DIR))
    maybeSpawnAnalysis(runtime)
  } catch {
    // Telemetry must never alter the decision path.
  }

  emit(serializeVerdict({ status: outcome.status, reason: outcome.reason }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Subject recorded for `guard recent`: the bash command, or the file path for file tools. */
function historySubject(input: ReturnType<typeof normalizeHookInput>): string | undefined {
  const params = input.tool_input && typeof input.tool_input === 'object' ? (input.tool_input as Record<string, unknown>) : {}
  const firstString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = params[key]
      if (typeof value === 'string' && value.trim()) return value
    }
    return undefined
  }
  const subject = input.tool_name === 'bash' ? firstString('command') : firstString('file_path', 'filePath', 'path')
  return subject ? truncateOneLine(subject, 200) : undefined
}

/**
 * Fire-and-forget learned-rule analysis on the configured cadence. opencode
 * has no session hook, so the cadence rides on decision processes (the
 * throttle check is two small file reads; the analysis runs detached).
 */
function maybeSpawnAnalysis(runtime: GuardRuntime): void {
  if (!runtime.config.enabled || !runtime.config.examineEnabled || !runtime.config.autoAnalyzeEnabled) return
  if (!shouldRunAutoAnalysis(loadAnalyzeState(runtime.config.analyzeStatePath), analysisIntervalMs(runtime.config))) return
  const here = dirname(fileURLToPath(import.meta.url))
  const child = spawn(process.execPath, [join(here, 'cli.js'), 'optimize', 'analyze'], {
    detached: true,
    stdio: 'ignore',
    cwd: here,
  })
  child.unref()
}

main().catch((error) => {
  try {
    failClosedAsk(`auto-guard 未捕获异常：${errorMessage(error)}；保守起见需要人工确认`)
  } catch {
    process.exit(0)
  }
})
