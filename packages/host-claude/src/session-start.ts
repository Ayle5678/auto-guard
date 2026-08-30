#!/usr/bin/env node
/**
 * SessionStart hook entry — Claude Code fires it on `startup` / `resume`.
 * Thin facade over the shared runtime (ADR-0016); dist file name unchanged.
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { CLAUDE_DESCRIPTOR } from './descriptor.ts'

createHookHost(CLAUDE_DESCRIPTOR).sessionMain()
