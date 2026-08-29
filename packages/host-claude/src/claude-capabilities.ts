/**
 * Claude Code host capabilities declaration (ADR-0007).
 *
 * claude runs the guard as a PreToolUse hook (one process per call): ask is
 * delegated to Claude Code's native permission prompt (the interactive
 * confirmation box), session state must live on disk to survive process
 * boundaries, and there is no push notification channel (decision history
 * replaces page notifications).
 */
import type { HostCapabilities } from '@auto-guard/core'

export const CLAUDE_CAPABILITIES: HostCapabilities = {
  askStyle: 'native',
  headlessFallback: 'host',
  hasUI: true,
  notifyChannels: { page: false, context: false },
  userBash: false,
  sessionState: 'disk',
}
