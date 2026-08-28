#!/usr/bin/env node
/**
 * PreToolUse hook entry for ZCode Auto Guard.
 *
 * Invoked by ZCode once per guarded tool call (matcher: Bash/Read/Write/Edit/
 * ApplyPatch). Protocol:
 *   stdin  → one JSON payload (session_id, tool_name, tool_input, ...)
 *   stdout → empty = pass; else strict JSON {hookSpecificOutput:{...}}
 *   exit   → always 0 (decisions travel in the JSON, never via exit code 2)
 *
 * Failure policy is fail-closed but never a hard brick: unexpected errors
 * surface as an `ask` so the human decides, and `/guard off` (enabled:false
 * in config.json) still bypasses everything even when the guard itself is sick.
 */
import { prepareDeletionMarker, classifyCommand, truncateOneLine, analysisIntervalMs, loadAnalyzeState, shouldRunAutoAnalysis } from '@auto-guard/core'
import type { Decision, GuardRequest, RulesFile } from '@auto-guard/core'
import { appendDecisionHistory, bootstrap, isDisabledByConfig, recordAudit, writeStatus, type GuardRuntime } from './bootstrap.ts'
import { AUTO_GUARD_DIR } from './config.ts'
import { decisionReasonText, hitDetail, serializeHookOutput, withDeletionHint, type HookAction } from './hook-output.ts'
import { normalizeHookInput, toGuardRequest } from './zcode-adapter.ts'
import { workspaceFromEnv } from './bootstrap.ts'
import { pruneSessions, sessionsRoot } from '@auto-guard/core'
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
  if (!text) {
    process.exit(0)
  }
  process.stdout.write(text + '\n', () => process.exit(0))
}

function failClosedAsk(reason: string): void {
  emit(serializeHookOutput({ action: 'ask', reason }))
}

type FinalOutcome = HookAction & {
  /** Decision metadata only relevant to status bookkeeping. */
  meta?: Pick<Decision, 'kind' | 'source' | 'risk'> & { reviewerFailed?: boolean; detail?: string }
}

/**
 * Translate the service decision the way pi-auto-guard's evaluate() did,
 * minus its interactive UI: ZCode's native prompt replaces the ask dialogs.
 */
async function evaluate(runtime: GuardRuntime, rawCommandRequest: GuardRequest): Promise<FinalOutcome> {
  // Headless directory-delete retries carry `[删除理由] <reason>` inside the
  // command; strip it before deciding so the marker never executes.
  const prepared = prepareDeletionMarker(rawCommandRequest)
  const decision = await runtime.service.decide(prepared.request)

  // First directory-delete hit: deny once so the AGENT retries with a
  // `[删除理由] <reason>` marker; the LLM then reviews that reason.
  if (decision.source === 'directory-delete' && decision.needsReason) {
    return { action: 'deny', reason: withDeletionHint(decisionReasonText(decision)), meta: pickMeta(decision, prepared.request, runtime.rules) }
  }

  // Directory-delete non-allow outcomes (LLM ask/deny or reviewer failure)
  // all get final say by the human — surfaced as ZCode's native prompt.
  if (decision.source === 'directory-delete' && decision.kind !== 'allow') {
    const flavor = decision.reviewerFailed ? '审查器故障，本次未过审' : 'LLM 未通过本次删除'
    const reason = `🛡️ auto-guard [删除复核] ${flavor}：${decision.reason ?? '未提供详情'}。是否仍要执行，请在确认框中决定。`
    return { action: 'ask', reason, meta: pickMeta(decision, prepared.request, runtime.rules) }
  }

  if (decision.kind === 'allow' || decision.kind === 'deny' || decision.kind === 'ask') {
    return mapPlainDecision(decision, prepared.request, runtime.rules)
  }
  return { action: 'deny', reason: decision.reason ?? '未知裁决，已拦截', meta: pickMeta(decision, prepared.request, runtime.rules) }
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



function mapPlainDecision(decision: Decision, request?: GuardRequest, rules?: RulesFile): FinalOutcome {
  const text = decisionReasonText(decision)
  switch (decision.kind) {
    case 'allow':
      return { action: 'allow', meta: pickMeta(decision, request, rules) }
    case 'deny':
      return { action: 'deny', reason: text, meta: pickMeta(decision, request, rules) }
    case 'ask':
      return { action: 'ask', reason: text, meta: pickMeta(decision, request, rules) }
  }
}

async function main(): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await readStdin())
  } catch {
    // Not a parseable hook payload — this should not happen from ZCode.
    failClosedAsk('auto-guard：无法解析 hook 输入（stdin 不是合法 JSON），保守起见需要人工确认')
    return
  }
  const input = normalizeHookInput(raw)

  // Never touch non-PreToolUse events; the matcher should filter them anyway.
  if (input.hook_event_name && input.hook_event_name !== 'PreToolUse') {
    emit('')
    return
  }

  // Master switch short-circuit — happens before anything can throw.
  try {
    const runtimeDisabled = isDisabledByConfig()
    if (runtimeDisabled) {
      emit('')
      return
    }
  } catch {
    emit('')
    return
  }

  let runtime: GuardRuntime
  try {
    runtime = bootstrap()
    if (!runtime.config.enabled) {
      emit('')
      return
    }
  } catch (error) {
    failClosedAsk(`auto-guard 初始化失败（检查 ~/.zcode/auto-guard/config.json）：${errorMessage(error)}；保守起见需要人工确认`)
    return
  }

  const extraction = toGuardRequest(input, workspaceFromEnv())

  let outcome: FinalOutcome
  if (extraction.kind === 'passthrough') {
    outcome = { action: 'allow' }
  } else if (extraction.kind === 'unreviewable') {
    outcome = { action: 'ask', reason: extraction.reason }
  } else {
    try {
      outcome = await evaluate(runtime, extraction.request)
    } catch (error) {
      outcome = { action: 'ask', reason: `auto-guard 裁决过程异常：${errorMessage(error)}；保守起见需要人工确认` }
    }
  }

  try {
    if (extraction.kind === 'guardable') {
      recordAudit(
        runtime,
        extraction.request,
        {
          kind: outcome.meta?.kind ?? (outcome.action === 'allow' ? 'allow' : 'ask'),
          source: outcome.meta?.source ?? 'error',
          risk: outcome.meta?.risk,
          reviewerFailed: outcome.meta?.reviewerFailed,
          reason: outcome.action === 'allow' ? undefined : outcome.reason,
        },
        outcome.action === 'allow' ? 'allow' : 'block',
      )
    }
    const entry = {
      lastRunAt: new Date().toISOString(),
      lastTool: input.tool_name,
      lastCommand: historySubject(input),
      lastDecisionKind: outcome.meta?.kind ?? outcome.action,
      lastDecisionSource: outcome.meta?.source,
      lastRisk: outcome.meta?.risk,
      lastDetail: outcome.meta?.detail ?? (outcome.action === 'allow' ? '直通/放行' : (outcome.reason ?? '').slice(0, 120)),
      reviewerLastFailed: outcome.meta?.reviewerFailed,
    }
    writeStatus(entry)
    appendDecisionHistory(entry)
    pruneSessions(sessionsRoot(AUTO_GUARD_DIR))
    maybeSpawnAnalysis(runtime)
  } catch {
    // Telemetry must never alter the decision path.
  }

  emit(serializeHookOutput(outcome))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Subject recorded for `guard recent`: the bash command, or the file path for file tools. */
function historySubject(input: ReturnType<typeof normalizeHookInput>): string | undefined {
  const params = input.tool_input && typeof input.tool_input === 'object'
    ? (input.tool_input as Record<string, unknown>)
    : {}
  const firstString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = params[key]
      if (typeof value === 'string' && value.trim()) return value
    }
    return undefined
  }
  const name = (input.tool_name ?? '').toLowerCase()
  const subject = name === 'bash' || name === 'pwsh'
    ? firstString('command')
    : firstString('file_path', 'filePath', 'path', 'notebook_path')
  return subject ? truncateOneLine(subject, 200) : undefined
}

/**
 * Fire-and-forget learned-rule analysis on the configured cadence (default
 * every 20 minutes of actual guard activity). The throttle check is two small
 * file reads; the analysis itself runs in a detached process so the hook's
 * decision latency is untouched.
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
