/**
 * Qoder host capabilities declaration (ADR-0007).
 *
 * Values mirror the claude host: qoder runs the guard as a PreToolUse hook
 * (one process per call), ask is delegated to Qoder's native permission
 * prompt (permissionDecision "ask"; docs.qoder.com/extensions/hooks), session
 * state must live on disk to survive process boundaries, and there is no push
 * notification channel (decision history replaces page notifications).
 */
import type { HostCapabilities } from '@auto-guard/core'

export const QODER_CAPABILITIES: HostCapabilities = {
  askStyle: 'native',
  headlessFallback: 'host',
  hasUI: true,
  notifyChannels: { page: false, context: false },
  userBash: false,
  sessionState: 'disk',
}
