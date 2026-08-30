/**
 * ZCode host config root (ADR-0003): `~/.zcode/auto-guard/` — re-exported
 * from the shared runtime's descriptor-driven config space (ADR-0016).
 * The path is unchanged from zcode-auto-guard 0.1.x so existing users keep
 * their rules, caches and audit data with zero migration.
 */
import { createConfigSpace } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

const space = createConfigSpace(ZCODE_DESCRIPTOR)

/** The zcode config root: `~/.zcode/auto-guard`. */
export const AUTO_GUARD_DIR = space.autoGuardDir

export const DEFAULT_CONFIG_PATH = space.defaultConfigPath

export const defaultConfig = space.defaultConfig
export const loadConfig = space.loadConfig
export const saveConfig = space.saveConfig
