#!/usr/bin/env node
/**
 * Shared PreToolUse / spawned-decision hook pipeline (ADR-0016), built from
 * a host descriptor: read one JSON payload from stdin → guard decision →
 * emit through the host's wire serializer → exit 0.
 *
 * Failure policy is fail-closed but never a hard brick: unexpected errors
 * surface as an `ask` so the human decides, and `guard off` (enabled:false
 * in config.json) still bypasses everything even when the guard itself is
 * sick.
 *
 * `io` is injectable so the contract tests can drive the pipeline headless
 * (string stdin, captured stdout, recorded exit) without a real process.
 */
import { spawn } from 'node:child_process'
import { buildSessionKey, classifyCommand, normalizeCommand, prepareDeletionMarker, truncateOneLine, analysisIntervalMs, loadAnalyzeState, shouldRunAutoAnalysis, resolveProcessLang, pruneSessions, sessionsRoot, sidHash, upsertPendingAsk, readPendingAsks, translateDecision } from '@auto-guard/core'
import type { Decision, GuardRequest, Lang, RulesFile } from '@auto-guard/core'
import { dirname, join } from 'node:path'
import type { HostDescriptor, OutcomeMeta, WireOutcome } from './descriptor.ts'
import { hasAskEscapeHatch } from './descriptor.ts'
import type { HostConfigSpace } from './config.ts'
import type { HostBootstrapKit, GuardRuntime } from './bootstrap.ts'
import type { HostExtraction, HookInput } from './extraction.ts'
import { parsePatchPaths } from './extraction.ts'
import type { HostMessage } from './messages.ts'
import { createDecisionRender } from './decision-render.ts'
import type { WireSerializer } from './descriptor.ts'

const MAX_STDIN_BYTES = 1_000_000

/** Test seam: everything that touches the surrounding process. */
export interface HookIo {
  readStdin(): Promise<string>
  writeOut(text: string): void
  exit(code?: number): void
  /** Detached learned-rule analysis; injectable so tests never spawn. */
  spawn(command: string, args: readonly string[]): void
  /** Where the sibling management CLI lives (defaults to the running entry's directory). */
  here(): string
}

function processIo(): HookIo {
  return {
    async readStdin() {
      process.stdin.setEncoding('utf8')
      let data = ''
      for await (const chunk of process.stdin) {
        data += chunk
        if (data.length > MAX_STDIN_BYTES) break
      }
      return data
    },
    /** Emit stdout and flush before exiting so no pipe buffering truncates JSON. */
    writeOut(text) {
      process.stdout.write(text + '\n', () => process.exit(0))
    },
    exit(code) {
      process.exit(code)
    },
    spawn(command, args) {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.unref()
    },
    here() {
      // The running entry is the host facade's dist file (hook-cli.js /
      // session-start.js), so the sibling management CLI (cli.js) lives in
      // the same directory — the layout the installer points users at.
      const entry = process.argv[1]
      return entry ? dirname(entry) : dirname(join('.', 'cli.js'))
    },
  }
}

export interface HookCliParts {
  descriptor: HostDescriptor
  space: HostConfigSpace
  kit: HostBootstrapKit
  extraction: HostExtraction
  message: HostMessage
  wire: WireSerializer
}

export function createHookCliMain(parts: HookCliParts): (io?: Partial<HookIo>) => Promise<void> {
  const { descriptor, space, kit, extraction, message, wire } = parts
  const render = createDecisionRender(message)
  const escapeHatch = hasAskEscapeHatch(descriptor)

  function emit(io: HookIo, text: string): void {
    if (!text) {
      io.exit(0)
      return
    }
    io.writeOut(text)
  }

  function failClosedAsk(io: HookIo, reason: string, lang: Lang = hookLang()): void {
    emit(io, wire.serialize({ action: 'ask', reason }, lang))
  }

  type FinalOutcome = WireOutcome

  /**
   * Language for the fail-closed paths that run before the runtime exists:
   * env > config.lang (unreadable yet) > machine default > zh (ADR-0011). Once
   * the runtime is up, its own once-per-process `runtime.lang` takes over.
   */
  function hookLang(): Lang {
    return resolveProcessLang(undefined)
  }

  /**
   * Translate the service decision the way the pre-runtime hosts did, minus
   * the interactive UI: the host's native prompt replaces the ask dialogs.
   * The translation policy itself comes from core (ADR-0025); this half only
   * dresses the reason in the hook wire wording. The caller has already
   * applied {@link prepareDeletionMarker} — the escape-hatch record
   * (ADR-0019) keys on the same prepared command the guard's cache lookup
   * will see on the next call.
   */
  async function evaluate(runtime: GuardRuntime, preparedRequest: GuardRequest, lang: Lang): Promise<FinalOutcome> {
    const decision = await runtime.service.decide(preparedRequest)
    const translation = translateDecision(decision, descriptor.capabilities)

    // First directory-delete hit: deny once so the AGENT retries with a
    // `[删除理由] <reason>` marker; the LLM then reviews that reason.
    if (translation.needsReason) {
      return { action: 'deny', reason: render.withDeletionHint(render.decisionReasonText(decision, lang), lang), meta: pickMeta(decision, preparedRequest, runtime.rules, lang) }
    }

    // Directory-delete non-allow outcomes (LLM ask/deny or reviewer failure)
    // all get final say by the human — surfaced as the host's native prompt.
    if (translation.needsHumanVeto) {
      const flavor = message(lang, translation.vetoTitleKey)
      const reason = message(lang, 'deleteAskReason', { flavor, reason: decision.reason ?? message(lang, 'deleteNoDetail') })
      return { action: 'ask', reason, meta: pickMeta(decision, preparedRequest, runtime.rules, lang) }
    }

    return mapPlainDecision(decision, preparedRequest, runtime.rules, lang)
  }

  function pickMeta(decision: Decision, request?: GuardRequest, rules?: RulesFile, lang: Lang = 'zh'): OutcomeMeta {
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
      detail: render.hitDetail(decision, pattern, lang),
    }
  }

  function mapPlainDecision(decision: Decision, request?: GuardRequest, rules?: RulesFile, lang: Lang = 'zh'): FinalOutcome {
    const text = render.decisionReasonText(decision, lang)
    switch (decision.kind) {
      case 'allow':
        return { action: 'allow', meta: pickMeta(decision, request, rules, lang) }
      case 'deny':
        return { action: 'deny', reason: text, meta: pickMeta(decision, request, rules, lang) }
      case 'ask':
        return { action: 'ask', reason: text, meta: pickMeta(decision, request, rules, lang) }
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /**
   * Best-effort pending-ask record for the escape hatch (ADR-0019). Lives in
   * the ENV-keyed session directory (the one the guard's disk cache uses)
   * while the record key mirrors the cache key the next identical call will
   * look up (normalized command, payload session inside). Returns true only
   * when verifiably on disk — the escape hint fires just then.
   */
  function recordPendingAsk(runtime: GuardRuntime, request: GuardRequest, outcome: FinalOutcome): boolean {
    try {
      // Shell commands are cached under their normalized text; file tools
      // under the target path — each is the stable text a repeat call shows.
      const subject = typeof request.command === 'string' ? normalizeCommand(request.command) : request.filePath
      if (typeof subject !== 'string' || !subject.trim()) return false
      const dir = join(sessionsRoot(space.autoGuardDir), sidHash(runtime.sessionId ?? '<no-session>'))
      const record = {
        key: buildSessionKey(request.session, request.workspace, subject),
        command: subject,
        risk: outcome.meta?.risk,
        reason: outcome.reason,
        workspace: request.workspace,
        askedAt: Date.now(),
      }
      upsertPendingAsk(dir, record)
      return readPendingAsks(dir).some((entry) => entry.key === record.key)
    } catch {
      return false
    }
  }

  /** Subject recorded for `guard recent`: the bash command, or the file path for file tools. */
  function historySubject(input: HookInput): string | undefined {
    const params = input.tool_input && typeof input.tool_input === 'object' ? (input.tool_input as Record<string, unknown>) : {}
    const firstString = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = params[key]
        if (typeof value === 'string' && value.trim()) return value
      }
      return undefined
    }
    const name = (input.tool_name ?? '').toLowerCase()
    // Patch-surface tools (codex apply_patch, SPEC 0015) carry no path field;
    // their subject is the first target path inside the patch text.
    const patchField = descriptor.guardedTools[input.tool_name ?? '']?.patchCommand
    if (patchField !== undefined) {
      const patchText = firstString(patchField)
      const firstPath = patchText ? parsePatchPaths(patchText)[0] : undefined
      return firstPath ? truncateOneLine(firstPath, 200) : undefined
    }
    const subject = descriptor.history.bashNames.includes(name) ? firstString('command') : firstString(...descriptor.history.pathFields)
    return subject ? truncateOneLine(subject, 200) : undefined
  }

  /**
   * Fire-and-forget learned-rule analysis on the configured cadence (default
   * every 20 minutes of actual guard activity). The throttle check is two small
   * file reads; the analysis itself runs in a detached process so the hook's
   * decision latency is untouched.
   */
  function maybeSpawnAnalysis(io: HookIo, runtime: GuardRuntime): void {
    if (!runtime.config.enabled || !runtime.config.examineEnabled || !runtime.config.autoAnalyzeEnabled) return
    if (!shouldRunAutoAnalysis(loadAnalyzeState(runtime.config.analyzeStatePath), analysisIntervalMs(runtime.config))) return
    io.spawn(process.execPath, [join(io.here(), 'cli.js'), 'optimize', 'analyze'])
  }

  return async function hookMain(ioInput?: Partial<HookIo>): Promise<void> {
    try {
      await runHook(ioInput)
    } catch (error) {
      try {
        const base = processIo()
        const io: HookIo = { ...base, ...ioInput }
        failClosedAsk(io, message(hookLang(), 'failUncaught', { error: errorMessage(error) }))
      } catch {
        ioInput?.exit ? ioInput.exit(0) : process.exit(0)
      }
    }
  }

  async function runHook(ioInput?: Partial<HookIo>): Promise<void> {
    const base = processIo()
    const io: HookIo = { ...base, ...ioInput }

    let raw: unknown
    try {
      raw = JSON.parse(await io.readStdin())
    } catch {
      // Not a parseable hook payload — this should not happen from the host.
      failClosedAsk(io, message(hookLang(), 'failStdinNotJson'))
      return
    }
    const input = extraction.normalizeHookInput(raw)

    // Never touch non-PreToolUse events; the matcher should filter them anyway.
    if (input.hook_event_name && input.hook_event_name !== 'PreToolUse') {
      emit(io, '')
      return
    }

    // Master switch short-circuit — happens before anything can throw.
    try {
      const runtimeDisabled = kit.isDisabledByConfig()
      if (runtimeDisabled) {
        emit(io, wire.serialize({ action: 'allow' }))
        return
      }
    } catch {
      emit(io, wire.serialize({ action: 'allow' }))
      return
    }

    let runtime: GuardRuntime
    try {
      runtime = kit.bootstrap()
      if (!runtime.config.enabled) {
        emit(io, wire.serialize({ action: 'allow' }))
        return
      }
    } catch (error) {
      failClosedAsk(io, message(hookLang(), 'failBootstrap', { configPath: space.configPathLabel, error: errorMessage(error) }))
      return
    }

    const lang = runtime.lang
    const extractionResult = extraction.toGuardRequest(input, kit.workspaceFromEnv(input.cwd), lang)

    // One prepare here feeds both the decision and the escape-hatch record so
    // the `[删除理由]` marker never reaches either.
    const prepared = extractionResult.kind === 'guardable' ? prepareDeletionMarker(extractionResult.request) : undefined

    let outcome: FinalOutcome
    if (extractionResult.kind === 'passthrough') {
      outcome = { action: 'allow' }
    } else if (extractionResult.kind === 'unreviewable') {
      outcome = { action: 'ask', reason: extractionResult.reason }
    } else {
      try {
        outcome = await evaluate(runtime, prepared!.request, lang)
      } catch (error) {
        outcome = { action: 'ask', reason: message(lang, 'failDecide', { error: errorMessage(error) }) }
      }
    }

    // ADR-0019: an ask on an escape-hatch host leaves a resolvable record and
    // gains the hint line (only when the record landed) plus the model
    // pre-brief. The emitted verdict shape is otherwise untouched.
    if (outcome.action === 'ask' && escapeHatch && prepared && recordPendingAsk(runtime, prepared.request, outcome)) {
      outcome = {
        ...outcome,
        reason: `${outcome.reason ?? ''}\n${message(lang, 'askEscapeHint')}`,
        additionalContext: message(lang, 'askModelContext'),
      }
    }

    try {
      if (extractionResult.kind === 'guardable') {
        kit.recordAudit(
          runtime,
          extractionResult.request,
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
        lastDetail: outcome.meta?.detail ?? (outcome.action === 'allow' ? message(lang, 'passthroughDetail') : (outcome.reason ?? '').slice(0, 120)),
        reviewerLastFailed: outcome.meta?.reviewerFailed,
      }
      kit.writeStatus(entry)
      kit.appendDecisionHistory(entry)
      pruneSessions(sessionsRoot(space.autoGuardDir))
      maybeSpawnAnalysis(io, runtime)
    } catch {
      // Telemetry must never alter the decision path.
    }

    emit(io, wire.serialize(outcome, lang))
  }
}
