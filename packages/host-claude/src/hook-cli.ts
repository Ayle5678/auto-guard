#!/usr/bin/env node
/**
 * PreToolUse hook entry for Claude Code Auto Guard — thin facade over the
 * shared runtime (ADR-0016). Dist file name unchanged (`dist/hook-cli.js`).
 *
 * Invoked by Claude Code once per guarded tool call (matcher:
 * Bash/Read/Write/Edit/NotebookEdit). Protocol (code.claude.com/docs/en/hooks):
 *   stdin  → one JSON payload (session_id, tool_name, tool_input, ...)
 *   stdout → empty = pass; else JSON {hookSpecificOutput:{...}}
 *   exit   → always 0 (decisions travel in the JSON, never via exit code 2)
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { CLAUDE_DESCRIPTOR } from './descriptor.ts'

createHookHost(CLAUDE_DESCRIPTOR).hookMain()
