/**
 * DSH notification payloads (ADR-0007: channel implementations live in the
 * adapter). Routing and all user-visible text come from core; this file only
 * builds the DSH-specific delivery shapes: page-only command/run + command/done
 * events and context-route notice messages.
 */
import { notifyRoute as coreNotifyRoute, pageNoticeText, sourceTag, type Decision, type DecisionKind, type GuardConfig, type Lang, type NotifyRoute } from '@auto-guard/core'
import { createNoticeMessage, type NoticeMessage } from './notice-message.ts'
import { dshMessage } from './messages.ts'

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
export function pageNotice(decision: Decision, lang: Lang = 'zh'): string {
  return pageNoticeText(decision, lang)
}

/** Log-only command/run + command/done payloads for a page-only notification. */
export function createPageNoticeEvents(decision: Decision, commandId: string, lang: Lang = 'zh'): PageNoticeEvents {
  const text = pageNoticeText(decision, lang)
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

/** Label for one decision kind on the context route, in the given language. */
function contextLabel(kind: DecisionKind, lang: Lang): string {
  return dshMessage(lang, kind === 'allow' ? 'contextAllow' : kind === 'deny' ? 'contextDeny' : 'contextAsk')
}

/** Context-route notice message, preserving the current user-visible text. */
export function createContextNotice(decision: Decision, lang: Lang = 'zh'): NoticeMessage {
  const source = decision.source === 'passthrough' || decision.source === 'error' ? '' : ` [${sourceTag(decision.source, lang)}]`
  const risk = decision.risk ? ` (risk: ${decision.risk})` : ''
  const reason = `: ${decision.reason ?? dshMessage(lang, 'contextFallbackReason')}`
  return createNoticeMessage(`${contextLabel(decision.kind, lang)}${source}${risk}${reason}`, `DSH Auto Guard: ${decision.kind} (${decision.source})`)
}
