#!/usr/bin/env node
/**
 * PreToolUse hook entry for Qoder Auto Guard — thin facade over the shared
 * runtime (ADR-0016). Dist file name unchanged (`dist/hook-cli.js`).
 *
 * Invoked by Qoder once per guarded tool call (matcher:
 * Bash|Read|Write|Edit|apply_patch|run_in_terminal|read_file|create_file|
 * search_replace|delete_file). Protocol (docs.qoder.com/extensions/hooks —
 * the Claude-compatible dialect, verified against the hook scripts Qoder
 * itself ships):
 *   stdin  → one JSON payload (session_id, tool_name, tool_input, ...)
 *   stdout → empty = pass; else strict JSON {hookSpecificOutput:{...}}
 *   exit   → always 0
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { QODER_DESCRIPTOR } from './descriptor.ts'

createHookHost(QODER_DESCRIPTOR).hookMain()
