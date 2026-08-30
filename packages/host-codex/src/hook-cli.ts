#!/usr/bin/env node
/**
 * PreToolUse hook entry for Codex Auto Guard — thin facade over the shared
 * runtime (ADR-0016). Dist file name `dist/hook-cli.js`; the installer
 * profile writes exactly this path into `~/.codex/hooks.json`.
 *
 * Invoked by Codex once per guarded tool call (matcher: Bash/apply_patch/
 * Edit/Write). Protocol (learn.chatgpt.com/docs/hooks):
 *   stdin  → one JSON payload (session_id, cwd, tool_name, tool_input, ...)
 *   stdout → empty = continue through the normal sandbox/approval flow;
 *            else {hookSpecificOutput:{permissionDecision:"deny",...}}
 *   exit   → always 0 (decisions travel in the JSON, never via exit code 2)
 *
 * Asks never leave this process as "ask": codex would discard the decision
 * and continue the call, so the capability-driven default wire (SPEC 0015)
 * renders them as deny with a human-readable note.
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { CODEX_DESCRIPTOR } from './descriptor.ts'

createHookHost(CODEX_DESCRIPTOR).hookMain()
