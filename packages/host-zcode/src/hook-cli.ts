#!/usr/bin/env node
/**
 * PreToolUse hook entry for ZCode Auto Guard — thin facade over the shared
 * runtime (ADR-0016). Dist file name unchanged (`dist/hook-cli.js`); the
 * installer profile and existing users are unaffected.
 *
 * Invoked by ZCode once per guarded tool call (matcher: Bash/Read/Write/Edit/
 * ApplyPatch). Protocol:
 *   stdin  → one JSON payload (session_id, tool_name, tool_input, ...)
 *   stdout → empty = pass; else strict JSON {hookSpecificOutput:{...}}
 *   exit   → always 0 (decisions travel in the JSON, never via exit code 2)
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

createHookHost(ZCODE_DESCRIPTOR).hookMain()
