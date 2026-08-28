/**
 * Dependency-free notice message factory. Mirrors the shape of DSH's
 * `createUserMessage` (plugin source, notice form) without importing the LLM
 * package at runtime, keeping the plugin resolvable from a plain link install.
 */
import { randomUUID } from 'node:crypto'

export interface NoticeMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: {
    kind: 'plugin'
    plugin: string
    form: 'notice'
    summary: string
  }
}

/** Build a user-role notice message stamped with the auto-guard plugin source. */
export function createNoticeMessage(text: string, summary: string): NoticeMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-auto-guard',
      form: 'notice',
      summary,
    },
  }
}
