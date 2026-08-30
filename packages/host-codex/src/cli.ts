#!/usr/bin/env node
/**
 * Management CLI for the Codex adapter — thin facade over the shared runtime
 * (ADR-0016). Dist file name `dist/cli.js`, rooted at `~/.codex/auto-guard/`.
 *
 * Usage: node dist/cli.js <group> <action> [args]
 */
import { runCliFacade } from '@auto-guard/host-runtime'
import { CODEX_DESCRIPTOR } from './descriptor.ts'

runCliFacade(CODEX_DESCRIPTOR, import.meta.url)
