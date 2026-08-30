/**
 * @auto-guard/host-runtime — the shared hook-form host runtime (ADR-0016).
 *
 * Host packages are thin facades: a descriptor file plus dist entry
 * re-exports. Process-form hosts (pi / dsh) only reuse {@link buildGuardDeps}.
 */
export type {
  HostDescriptor,
  ToolMapping,
  GuardTool,
  WireOutcome,
  OutcomeMeta,
  WireSerializer,
} from './descriptor.ts'
export { synthesizeShellCommand, parsePatchPaths } from './extraction.ts'
export type { HookInput, GuardableExtraction, HostExtraction } from './extraction.ts'
export { createExtraction } from './extraction.ts'
export { createConfigSpace, type HostConfigSpace } from './config.ts'
export { createHostMessage, type HostMessage, type RuntimeMessageKey } from './messages.ts'
export { createBootstrap, type HostBootstrapKit, type GuardRuntime, type RuntimeStatus } from './bootstrap.ts'
export { buildGuardDeps, createGuardService, type GuardDepsParts, type GuardWiring } from './guard-deps.ts'
export { createDecisionRender } from './decision-render.ts'
export { createHookCliMain, type HookIo } from './hook-cli.ts'
export { createCliMain, type CliParts } from './cli.ts'
export { createSessionMain, type SessionMainOptions } from './session-start.ts'
export { createHookHost, type CreateHookHostOptions, type HookHost } from './create-hook-host.ts'
export { runCliFacade } from './cli-facade.ts'

// Default (Claude-compatible `hookSpecificOutput`) wire.
export {
  defaultWire,
  createDefaultWire,
  serializeHookOutput,
  type HookAction,
  type HookOutput,
  type HookSpecificOutput,
} from './wire.ts'

// OpenCode `{status,reason}` wire (serializer slot + plugin-side parsing).
export {
  opencodeWire,
  serializeVerdict,
  parseVerdict,
  statusToReply,
  statusToOutputStatus,
  type GuardStatus,
  type GuardVerdict,
} from './wire-opencode.ts'
