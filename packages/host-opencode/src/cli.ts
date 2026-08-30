#!/usr/bin/env node
/**
 * Management CLI for the OpenCode host adapter — thin facade over the shared runtime
 * (ADR-0016). Dist file name unchanged (`dist/cli.js`).
 *
 * Usage: node dist/cli.js <group> <action> [args]
 */
import { runCliFacade } from '@auto-guard/host-runtime'
import { OPENCODE_DESCRIPTOR } from './descriptor.ts'

runCliFacade(OPENCODE_DESCRIPTOR, import.meta.url)
