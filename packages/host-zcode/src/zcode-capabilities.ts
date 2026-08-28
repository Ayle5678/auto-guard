/**
 * ZCode host capabilities declaration (ADR-0007).
 *
 * zcode runs the guard as a PreToolUse hook (one process per call): ask is
 * delegated to the host's native permission prompt, there is no interactive
 * UI and no push channel (decision history replaces page notifications), and
 * session state must live on disk to survive process boundaries.
 */
import type { HostCapabilities } from '@auto-guard/core'

export const ZCODE_CAPABILITIES: HostCapabilities = {
  askStyle: 'native',
  headlessFallback: 'host',
  hasUI: false,
  notifyChannels: { page: false, context: false },
  userBash: false,
  sessionState: 'disk',
}
