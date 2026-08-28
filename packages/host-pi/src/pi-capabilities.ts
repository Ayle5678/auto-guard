/**
 * Pi host capabilities declaration (ADR-0007).
 *
 * pi presents a four-option ask dialog with per-session memory, can deliver
 * both page and context notifications, surfaces user shell commands, and
 * keeps session state in memory (long-lived extension process).
 */
import type { HostCapabilities } from '@auto-guard/core'

export const PI_CAPABILITIES: HostCapabilities = {
  askStyle: 'four-state',
  headlessFallback: 'deny',
  hasUI: true,
  notifyChannels: { page: true, context: true },
  userBash: true,
  sessionState: 'memory',
}
