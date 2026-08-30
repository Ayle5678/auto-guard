#!/usr/bin/env node
/**
 * SessionStart hook entry — Codex fires it on `startup` / `resume`.
 * Thin facade over the shared runtime (ADR-0016); dist file name
 * `dist/session-start.js`.
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { CODEX_DESCRIPTOR } from './descriptor.ts'

createHookHost(CODEX_DESCRIPTOR).sessionMain()
