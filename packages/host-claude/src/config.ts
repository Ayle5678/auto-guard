/**
 * Claude Code host config root (ADR-0003): `~/.claude/auto-guard/` —
 * re-exported from the shared runtime's descriptor-driven config space
 * (ADR-0016). One independent config root per host, so a Claude Code user's
 * rules never leak into (or get shadowed by) another host's guard state.
 */
import { createConfigSpace } from '@auto-guard/host-runtime'
import { CLAUDE_DESCRIPTOR } from './descriptor.ts'

const space = createConfigSpace(CLAUDE_DESCRIPTOR)

/** The claude config root: `~/.claude/auto-guard`. */
export const AUTO_GUARD_DIR = space.autoGuardDir

export const DEFAULT_CONFIG_PATH = space.defaultConfigPath

export const defaultConfig = space.defaultConfig
export const loadConfig = space.loadConfig
export const saveConfig = space.saveConfig
