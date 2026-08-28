/**
 * Notification text builder. Pure so it can be tested without a Pi runtime.
 * The Pi entry point sends this through `ctx.ui.notify` (never into context).
 */
import type { Decision, GuardConfig, NotifyRoute } from './types.ts'

/** Short Chinese tag for which guard layer produced the decision. */
export function sourceTag(source: Decision['source']): string {
  switch (source) {
    case 'static-allow': return '白名单'
    case 'user-confirmed': return '预授权'
    case 'hard-deny': return '黑名单'
    case 'llm': return 'LLM'
    case 'session-cache': return '会话缓存'
    case 'persistent-cache': return '持久缓存'
    case 'directory-delete': return '删除复核'
    case 'file-tracker': return '写后执行'
    case 'sensitive-path': return '敏感路径'
    case 'history': return '历史'
    case 'learned': return '学习规则'
    default: return '其他'
  }
}

/** Build the user-visible text for a guard decision (never includes script content). */
export function notificationText(decision: Decision): string {
  const label = decision.kind === 'allow' ? '✅ 放行' : decision.kind === 'deny' ? '⛔ 拦截' : '❓ 询问'
  const risk = decision.risk ? ` (risk: ${decision.risk})` : ''
  const reason = decision.reason ? `: ${decision.reason}` : ''
  const source = decision.source === 'passthrough' || decision.source === 'error' ? '' : ` [${sourceTag(decision.source)}]`
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
export function pageNoticeText(decision: Decision): string {
  const parts = ['Auto Guard', decision.kind === 'allow' ? '放行' : decision.kind === 'deny' ? '拦截' : '询问']
  if (decision.risk) parts.push(`risk: ${decision.risk}`)
  parts.push(`来源: ${sourceTag(decision.source)}`)
  parts.push('未进入上下文')
  return parts.join(' · ')
}
