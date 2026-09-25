/**
 * Engine-level host policy, sunk into core (ADR-0025): the decision→action
 * translation, the notification routing gate and the tool-call audit record
 * previously lived as verbatim copies across the three adapters. These
 * functions depend only on core types (capabilities, audit store, command
 * classification); hosts keep their sinks — wire serialization, interactive
 * dialogs, session injection — plus whatever wording their surface dresses
 * on the returned reason. Wording keys (not strings) cross the boundary: the
 * text itself lives in the shared guard-surface catalog (ADR-0023).
 */
import type { AuditStore } from './audit.ts'
import { classifyCommand } from './rules.ts'
import type { GuardMessageKey } from './guard-messages.ts'
import { effectiveNotifyRoute, type HostCapabilities } from './host-capabilities.ts'
import { notifyRoute } from './notify.ts'
import type { Decision, GuardConfig, GuardRequest, RulesFile } from './types.ts'

/** Core translation of one guard decision (ADR-0025). */
export type DecisionTranslation =
  /** Plain decision: the kind maps straight to the host action. */
  | { action: 'allow' | 'deny' | 'ask'; reason: string | undefined; needsReason: false; needsHumanVeto: false; vetoTitleKey: undefined }
  /** First directory-delete hit: deny once so the agent retries with a `[删除理由]` marker. */
  | { action: 'deny'; reason: string | undefined; needsReason: true; needsHumanVeto: false; vetoTitleKey: undefined }
  /** Directory deletion the human gets the final say on. */
  | { action: 'ask'; reason: string | undefined; needsReason: false; needsHumanVeto: true; vetoTitleKey: GuardMessageKey }

/**
 * True when the host itself services every `ask` through its own approval
 * flow (DSH's `ctx.approval`, a one-shot style with a UI): the veto
 * escalation there only dresses flat denies. Hook-host asks ride the wire
 * instead — including codex's one-shot-without-UI ask, which the wire
 * translates to a deny — so they all keep the escalation.
 */
function hostAbsorbsAsk(capabilities: Pick<HostCapabilities, 'askStyle' | 'hasUI'>): boolean {
  return capabilities.askStyle === 'one-shot' && capabilities.hasUI
}

/**
 * Translate a guard decision into the action every host takes. The policy
 * (needs-reason denial, the human veto on non-allowed directory deletions,
 * the plain kind mapping) is single-sourced here; only the ask *sink*
 * differs per host (native prompt, four-state dialog, one-shot approval).
 * The one carve-out — {@link hostAbsorbsAsk} hosts keep an LLM ask on a
 * directory deletion a plain ask — is the preserved DSH fallback, driven by
 * capabilities.
 */
export function translateDecision(decision: Decision, capabilities: Pick<HostCapabilities, 'askStyle' | 'hasUI'>): DecisionTranslation {
  if (decision.source === 'directory-delete' && decision.needsReason) {
    return { action: 'deny', reason: decision.reason, needsReason: true, needsHumanVeto: false, vetoTitleKey: undefined }
  }
  if (decision.source === 'directory-delete' && decision.kind !== 'allow' && !(decision.kind === 'ask' && hostAbsorbsAsk(capabilities))) {
    return {
      action: 'ask',
      reason: decision.reason,
      needsReason: false,
      needsHumanVeto: true,
      vetoTitleKey: decision.reviewerFailed ? 'deleteFailReviewerTitle' : 'deleteFailLlmTitle',
    }
  }
  return { action: decision.kind, reason: decision.reason, needsReason: false, needsHumanVeto: false, vetoTitleKey: undefined }
}

/**
 * Where a decision notification should land on this host, or undefined to
 * stay silent: the cache/LLM family gates, the rule-allow UI-only clamp and
 * the host channel clamp in one owner. Payload text stays with the sinks
 * (`notificationText` / `pageNoticeText` for page, host protocol wrappers
 * for context).
 */
export function resolveNotify(
  decision: Decision,
  config: Pick<GuardConfig, 'notifyCacheHit' | 'notifyLlmDecision' | 'notifyAllow' | 'notifyDeny' | 'notifyAsk'>,
  capabilities: Pick<HostCapabilities, 'notifyChannels'>,
): 'page' | 'context' | undefined {
  const isRuleAllow = decision.source === 'static-allow' || decision.source === 'user-confirmed'
  if (decision.source === 'session-cache' || decision.source === 'persistent-cache' || decision.source === 'history' || decision.source === 'learned') {
    if (!config.notifyCacheHit) return undefined
  } else if (decision.source === 'llm' || decision.source === 'file-tracker' || decision.source === 'directory-delete') {
    if (!config.notifyLlmDecision) return undefined
  } else if (!isRuleAllow) {
    return undefined
  }
  let route = notifyRoute(decision, config)
  // Rule-based allows are always UI-only; they never enter the model context.
  if (isRuleAllow && route === 'context') route = 'page'
  const effective = effectiveNotifyRoute(route, capabilities)
  return effective === 'off' ? undefined : effective
}

/** One audit record for a reviewed shell tool call; the record schema's single owner (ADR-0025). */
export function recordToolCallAudit(
  store: AuditStore,
  rules: RulesFile,
  request: GuardRequest,
  decision: Decision,
  finalAction: 'allow' | 'block' | undefined,
  config: Pick<GuardConfig, 'enabled' | 'examineEnabled'>,
  source: 'tool_call' | 'user_bash' = 'tool_call',
): void {
  if (!config.enabled || !config.examineEnabled) return
  if (request.tool !== 'bash' && request.tool !== 'pwsh') return
  if (typeof request.command !== 'string') return
  const rulePattern = classifyCommand(request.command, rules).rule?.pattern
  store.insert({
    sessionId: request.session,
    workspace: request.workspace,
    source,
    tool: request.tool,
    command: request.command,
    decision,
    finalAction,
    rulePattern,
  })
}
