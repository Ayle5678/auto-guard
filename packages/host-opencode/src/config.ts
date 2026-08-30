/**
 * OpenCode host config root (ADR-0003): `~/.config/opencode/auto-guard/` —
 * re-exported from the shared runtime's descriptor-driven config space
 * (ADR-0016). One independent config root per host; OpenCode's own config
 * lives next door in `~/.config/opencode/opencode.json` (installer-written).
 */
import { createConfigSpace } from '@auto-guard/host-runtime'
import { OPENCODE_DESCRIPTOR } from './descriptor.ts'

const space = createConfigSpace(OPENCODE_DESCRIPTOR)

/** The opencode config root: `~/.config/opencode/auto-guard`. */
export const AUTO_GUARD_DIR = space.autoGuardDir

export const DEFAULT_CONFIG_PATH = space.defaultConfigPath

export const defaultConfig = space.defaultConfig
export const loadConfig = space.loadConfig
export const saveConfig = space.saveConfig
