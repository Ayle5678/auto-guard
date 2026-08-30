/**
 * OpenCode host capabilities declaration (ADR-0007, ADR-0015).
 *
 * opencode delegates ask to the host permission system: guard asks land on
 * the native TUI (once / always / reject), and the guard itself runs as a
 * spawned node process per decision (session state on disk). "always"
 * approvals become host allow rules — those calls bypass the guard entirely
 * (accepted consequence, ADR-0015).
 */
import type { HostCapabilities } from '@auto-guard/core'

export const OPENCODE_CAPABILITIES: HostCapabilities = {
  askStyle: 'native',
  headlessFallback: 'host',
  hasUI: true,
  notifyChannels: { page: false, context: false },
  userBash: false,
  sessionState: 'disk',
}
