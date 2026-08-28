/**
 * Host capabilities model (ADR-0007).
 *
 * core only produces decisions and ask states; how an ask lands, where a
 * notification goes and which process model applies are declared by the host
 * adapter. Adding a host means writing an adapter plus one of these
 * declarations — core needs no new branches.
 */

/** How the host presents an `ask` to the user. */
export type AskStyle =
  /** pi: four-option confirm dialog with per-session memory. */
  | 'four-state'
  /** dsh: the host's one-shot approval semantics. */
  | 'one-shot'
  /** e.g. hook-based hosts: delegate to the host's native permission prompt. */
  | 'native'

/** Where an `ask` ends up when no interactive UI is available. */
export type HeadlessFallback =
  /** The adapter denies the call (fail-closed). */
  | 'deny'
  /** The adapter allows the call (fail-open; only for trusted setups). */
  | 'allow'
  /** The host permission system itself resolves the ask (hook protocol). */
  | 'host'

export interface HostCapabilities {
  askStyle: AskStyle
  headlessFallback: HeadlessFallback
  /** The host can show interactive dialogs at all. */
  hasUI: boolean
  /** Notification channels the host can actually deliver. */
  notifyChannels: {
    page: boolean
    context: boolean
  }
  /** The host surfaces plain user shell commands (`user_bash`) to the guard. */
  userBash: boolean
  /** Which session-state implementation the adapter bootstraps (ADR-0004). */
  sessionState: 'memory' | 'disk'
}

/**
 * Clamp a configured notify route to a channel the host can deliver.
 * A route whose channel is missing degrades to the other channel, then off.
 */
export function effectiveNotifyRoute(
  route: 'page' | 'context' | 'off',
  capabilities: Pick<HostCapabilities, 'notifyChannels'>,
): 'page' | 'context' | 'off' {
  if (route === 'page') return capabilities.notifyChannels.page ? 'page' : capabilities.notifyChannels.context ? 'context' : 'off'
  if (route === 'context') return capabilities.notifyChannels.context ? 'context' : capabilities.notifyChannels.page ? 'page' : 'off'
  return 'off'
}

/** True when the host should wire the four-state ask memory (ADR-0007). */
export function usesFourStateAsk(capabilities: Pick<HostCapabilities, 'askStyle'>): boolean {
  return capabilities.askStyle === 'four-state'
}
