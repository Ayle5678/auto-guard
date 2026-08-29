/**
 * Structural types for the surfaces auto-guard touches in the OpenCode
 * plugin API (@opencode-ai/plugin 1.18.x), verified against the installed
 * type definitions and the compiled host binary (see
 * .scratch/0004-host-claude-opencode/research/opencode-plugin-api.md).
 *
 * Structural only — the package stays zero-dependency (host-pi's pi-sdk.d.ts
 * precedent) and nothing imports @opencode-ai/plugin at runtime; OpenCode's
 * bun runtime supplies the real objects.
 */

/** The `permission.asked` bus event payload (PermissionV1.Request in the host). */
export interface PermissionAskedProperties {
  id: string
  sessionID: string
  /** Permission key: bash / edit / read / glob / webfetch / … */
  permission: string
  /** Matched rule patterns — the bash command text, or the worktree-relative file path. */
  patterns?: string[]
  /** Tool-supplied context: bash → {command}, edit → {filepath, diff}, read → {}. */
  metadata?: Record<string, unknown>
  always?: string[]
  tool?: { messageID?: string; callID?: string }
}

/** A bus event delivered to the plugin `event` hook. */
export interface BusEvent {
  id: string
  type: string
  properties: unknown
}

/** The SDK `Permission` input of the `permission.ask` hook (typed but never dispatched in 1.18.x). */
export interface SdkPermission {
  id: string
  type: string
  pattern?: string | string[]
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
}

/** Reply surface of the OpenCode client handed to plugins (`client.permission.reply`). */
export interface PermissionReplier {
  permission: {
    reply: (parameters: { requestID: string; reply: 'once' | 'always' | 'reject'; message?: string }) => Promise<unknown>
  }
}

/** The plugin input OpenCode passes to every plugin function. */
export interface OpencodePluginInput {
  client: PermissionReplier
  project: unknown
  directory: string
  worktree: string
  serverUrl: URL
  $: unknown
}

/** Hooks auto-guard registers (subset of the full Hooks interface). */
export interface AutoGuardHooks {
  dispose?: () => Promise<void>
  event?: (input: { event: BusEvent }) => Promise<void>
  'permission.ask'?: (input: SdkPermission, output: { status: 'ask' | 'deny' | 'allow' }) => Promise<void>
}

export type AutoGuardPlugin = (input: OpencodePluginInput) => Promise<AutoGuardHooks>
