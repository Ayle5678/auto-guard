/**
 * DSH notification payloads (ADR-0007: channel implementations live in the
 * adapter). Routing and all user-visible text come from core; this file only
 * builds the DSH-specific delivery shapes: page-only command/run + command/done
 * events and context-route notice messages.
 */
import { notifyRoute as coreNotifyRoute, pageNoticeText, sourceTag, type Decision, type DecisionKind, type GuardConfig, type NotifyRoute } from '@auto-guard/core'
import { createNoticeMessage, type NoticeMessage } from './notice-message.ts'

export { notifyRoute } from '@auto-guard/core'

export interface PageNoticeCommandRun {
  commandId: string
  name: 'auto-guard'
  args: string
  source: { kind: 'user' }
}

export interface PageNoticeCommandDone {
  commandId: string
  kind: 'success'
  text: string
}

export interface PageNoticeEvents {
  run: PageNoticeCommandRun
  done: PageNoticeCommandDone
}

/** Single-line page text for a page-only notification (core wording). */
export function pageNotice(decision: Decision): string {
  return pageNoticeText(decision)
}

/** Log-only command/run + command/done payloads for a page-only notification. */
export function createPageNoticeEvents(decision: Decision, commandId: string): PageNoticeEvents {
  const text = pageNoticeText(decision)
  return {
    run: {
      commandId,
      name: 'auto-guard',
      args: text,
      source: { kind: 'user' },
    },
    done: {
      commandId,
      kind: 'success',
      text,
    },
  }
}

const CONTEXT_LABELS: Record<DecisionKind, string> = {
  allow: '✅ 放行',
  deny: '⛔ 拦截',
  ask: '❓ 询问',
}

/** Context-route notice message, preserving the current user-visible text. */
export function createContextNotice(decision: Decision): NoticeMessage {
  const source = decision.source === 'passthrough' || decision.source === 'error' ? '' : ` [${sourceTag(decision.source)}]`
  const risk = decision.risk ? ` (risk: ${decision.risk})` : ''
  const reason = `: ${decision.reason ?? '由 DSH Auto Guard 决定'}`
  return createNoticeMessage(`${CONTEXT_LABELS[decision.kind]}${source}${risk}${reason}`, `DSH Auto Guard: ${decision.kind} (${decision.source})`)
}
