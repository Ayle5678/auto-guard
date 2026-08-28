/**
 * DSH host capabilities declaration (ADR-0007).
 *
 * dsh presents the host's one-shot approval semantics, falls back to deny
 * when no approval UI is mounted (fail-closed), delivers both page and
 * context notifications, does not surface plain user shell commands, and
 * keeps session state in memory (long-lived plugin process).
 */
import type { HostCapabilities } from '@auto-guard/core'

export const DSH_CAPABILITIES: HostCapabilities = {
  askStyle: 'one-shot',
  headlessFallback: 'deny',
  hasUI: true,
  notifyChannels: { page: true, context: true },
  userBash: false,
  sessionState: 'memory',
}
