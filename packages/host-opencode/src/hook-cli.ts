#!/usr/bin/env node
/**
 * Spawned decision entry for OpenCode Auto Guard (ADR-0015 process model) —
 * thin facade over the shared runtime (ADR-0016). Dist file name unchanged
 * (`dist/hook-cli.js`); the plugin spawns this exact path per decision.
 *
 * The plugin runs inside OpenCode's bun process; every decision spawns
 * `node dist/hook-cli.js` so the core never enters bun. Protocol:
 *   stdin  → one JSON payload {tool_name, tool_input, session_id, cwd}
 *   stdout → ALWAYS one JSON verdict {"status":"allow|deny|ask","reason"?}
 *   exit   → always 0
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { OPENCODE_DESCRIPTOR } from './descriptor.ts'

createHookHost(OPENCODE_DESCRIPTOR).hookMain()
