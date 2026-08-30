/**
 * Codex host descriptor (ADR-0016): the pure data the shared runtime needs
 * to run the guard for OpenAI Codex CLI. Behavior lives in
 * @auto-guard/host-runtime; this file only declares how codex differs.
 *
 * Protocol notes (SPEC 0015, learn.chatgpt.com/docs/hooks):
 *  - Shell/unified exec reach the hook as `tool_name: "Bash"` with the whole
 *    script in `tool_input.command` (Claude-compatible spelling).
 *  - File edits go through `apply_patch` (aliases `Edit`/`Write`); the
 *    payload again carries everything in `tool_input.command` — as a V4A
 *    patch text, so the mapping uses `patchCommand` and the runtime parses
 *    every `*** … File:` header into the reviewed path set.
 *  - There is no plain file-read function tool; `read` is not wired. MCP
 *    tools pass through untouched in v1.
 *  - The payload itself carries `session_id` and `cwd`; codex injects no
 *    identity env vars, so the env chains stay empty and the runtime falls
 *    back to the payload fields.
 */
import type { HostDescriptor } from '@auto-guard/host-runtime'
import { CODEX_CAPABILITIES } from './codex-capabilities.ts'

export const CODEX_DESCRIPTOR: HostDescriptor = {
  hostId: 'codex',
  configRootSegments: ['.codex', 'auto-guard'],
  guardedTools: {
    Bash: { guardTool: 'bash' },
    apply_patch: { guardTool: 'edit', patchCommand: 'command' },
    // Edit/Write are documented aliases of apply_patch; same patch-text payload.
    Edit: { guardTool: 'edit', patchCommand: 'command' },
    Write: { guardTool: 'edit', patchCommand: 'command' },
  },
  pathFields: ['file_path', 'filePath', 'path'],
  contentFields: ['content', 'file_text'],
  history: {
    bashNames: ['bash'],
    pathFields: ['file_path', 'filePath', 'path'],
  },
  envNames: {
    session: [],
    workspace: [],
  },
  capabilities: CODEX_CAPABILITIES,
  // wire: omitted — codex speaks the default hookSpecificOutput dialect, with
  // ask→deny applied by the runtime because headlessFallback is 'deny'.
}
