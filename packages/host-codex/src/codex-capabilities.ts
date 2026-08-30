/**
 * Codex host capabilities declaration (ADR-0007, SPEC 0015).
 *
 * codex runs the guard as a PreToolUse hook in `~/.codex/hooks.json`. Its
 * protocol parses `permissionDecision:"ask"` but does not support it — the
 * hook run is marked failed and the tool call CONTINUES (fail-open) — so an
 * ask can never be delegated to a prompt: the wire translates every ask into
 * a deny (`headlessFallback: 'deny'`, the dsh precedent). There is no
 * interactive UI and no push channel (decision history replaces page
 * notifications), and session state must live on disk to survive process
 * boundaries.
 */
import type { HostCapabilities } from '@auto-guard/core'

export const CODEX_CAPABILITIES: HostCapabilities = {
  askStyle: 'one-shot',
  headlessFallback: 'deny',
  hasUI: false,
  notifyChannels: { page: false, context: false },
  userBash: false,
  sessionState: 'disk',
}
