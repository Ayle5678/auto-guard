/**
 * Codex host config root (ADR-0003): `~/.codex/auto-guard/` — re-exported
 * from the shared runtime's descriptor-driven config space (ADR-0016).
 */
import { createConfigSpace } from '@auto-guard/host-runtime'
import { CODEX_DESCRIPTOR } from './descriptor.ts'

const space = createConfigSpace(CODEX_DESCRIPTOR)

/** The codex config root: `~/.codex/auto-guard`. */
export const AUTO_GUARD_DIR = space.autoGuardDir

export const DEFAULT_CONFIG_PATH = space.defaultConfigPath

export const defaultConfig = space.defaultConfig
export const loadConfig = space.loadConfig
export const saveConfig = space.saveConfig
