/**
 * Qoder host config root (ADR-0003): `~/.qoder/auto-guard/` — re-exported
 * from the shared runtime's descriptor-driven config space (ADR-0016).
 */
import { createConfigSpace } from '@auto-guard/host-runtime'
import { QODER_DESCRIPTOR } from './descriptor.ts'

const space = createConfigSpace(QODER_DESCRIPTOR)

/** The qoder config root: `~/.qoder/auto-guard`. */
export const AUTO_GUARD_DIR = space.autoGuardDir

export const DEFAULT_CONFIG_PATH = space.defaultConfigPath

export const defaultConfig = space.defaultConfig
export const loadConfig = space.loadConfig
export const saveConfig = space.saveConfig
