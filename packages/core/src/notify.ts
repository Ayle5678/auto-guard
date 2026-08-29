/**
 * Notification text builder. Pure so it can be tested without a Pi runtime.
 * The Pi entry point sends this through `ctx.ui.notify` (never into context).
 * Text resolves from the core catalog; the trailing `lang` parameter defaults
 * to zh so existing callers keep byte-stable output (ADR-0011).
 */
import { coreMessage } from './messages.ts'
import type { Lang } from './lang.ts'
import type { Decision, GuardConfig, NotifyRoute } from './types.ts'

/** Short tag for which guard layer produced the decision. */
export function sourceTag(source: Decision['source'], lang: Lang = 'zh'): string {
  switch (source) {
    case 'static-allow': return coreMessage(lang, 'tagStaticAllow')
    case 'user-confirmed': return coreMessage(lang, 'tagUserConfirmed')
    case 'hard-deny': return coreMessage(lang, 'tagHardDeny')
    case 'llm': return coreMessage(lang, 'tagLlm')
    case 'session-cache': return coreMessage(lang, 'tagSessionCache')
    case 'persistent-cache': return coreMessage(lang, 'tagPersistentCache')
    case 'directory-delete': return coreMessage(lang, 'tagDirectoryDelete')
    case 'file-tracker': return coreMessage(lang, 'tagFileTracker')
    case 'sensitive-path': return coreMessage(lang, 'tagSensitivePath')
    case 'history': return coreMessage(lang, 'tagHistory')
    case 'learned': return coreMessage(lang, 'tagLearned')
    default: return coreMessage(lang, 'tagOther')
  }
}

/** Build the user-visible text for a guard decision (never includes script content). */
export function notificationText(decision: Decision, lang: Lang = 'zh'): string {
  const label = coreMessage(lang, decision.kind === 'allow' ? 'kindAllow' : decision.kind === 'deny' ? 'kindDeny' : 'kindAsk')
  const risk = decision.risk ? ` (risk: ${decision.risk})` : ''
  const reason = decision.reason ? `: ${decision.reason}` : ''
  const source = decision.source === 'passthrough' || decision.source === 'error' ? '' : ` [${sourceTag(decision.source, lang)}]`
  return `[Auto Guard] ${label}${source}${risk}${reason}`
}

/**
 * Resolve where a decision notification should go.
 *
 * `page` = UI-only (`ctx.ui.notify`, never in model context); `context` =
 * injected into the model/session context; `off` = no notification at all.
 */
export function notifyRoute(
  decision: Decision,
  config: Pick<GuardConfig, 'notifyAllow' | 'notifyDeny' | 'notifyAsk'>,
): NotifyRoute {
  switch (decision.kind) {
    case 'allow':
      return config.notifyAllow
    case 'deny':
      return config.notifyDeny
    case 'ask':
      return config.notifyAsk
  }
}

/** Single-line page-route text (UI only, never enters context). */
export function pageNoticeText(decision: Decision, lang: Lang = 'zh'): string {
  const parts = ['Auto Guard', coreMessage(lang, decision.kind === 'allow' ? 'pageKindAllow' : decision.kind === 'deny' ? 'pageKindDeny' : 'pageKindAsk')]
  if (decision.risk) parts.push(`risk: ${decision.risk}`)
  parts.push(`${coreMessage(lang, 'noticeSourcePrefix')}${sourceTag(decision.source, lang)}`)
  parts.push(coreMessage(lang, 'noticeNotInContext'))
  return parts.join(' · ')
}
