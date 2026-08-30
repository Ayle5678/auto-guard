#!/usr/bin/env node
/**
 * SessionStart hook entry — ZCode fires it on `startup` / `resume`.
 * Thin facade over the shared runtime (ADR-0016); dist file name unchanged.
 */
import { createHookHost } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

createHookHost(ZCODE_DESCRIPTOR).sessionMain()
