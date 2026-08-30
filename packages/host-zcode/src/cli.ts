#!/usr/bin/env node
/**
 * Management CLI for the ZCode plugin — thin facade over the shared runtime
 * (ADR-0016). Dist file name unchanged (`dist/cli.js`).
 *
 * Usage: node dist/cli.js <group> <action> [args]
 */
import { runCliFacade } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

runCliFacade(ZCODE_DESCRIPTOR, import.meta.url)
