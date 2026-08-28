/**
 * Pi host config root (ADR-0003): `~/.pi/auto-guard/`.
 *
 * Wraps the core config mechanics with the pi-specific root directory and
 * defaults. The path is unchanged from pi-auto-guard 0.1.x so existing users
 * keep their rules, caches and audit data with zero migration.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultGuardConfig, loadConfig as loadCoreConfig, saveConfig as saveCoreConfig } from '@auto-guard/core'
import type { GuardConfig } from '@auto-guard/core'

/** The pi config root: `~/.pi/auto-guard`. */
export const AUTO_GUARD_DIR = join(homedir(), '.pi', 'auto-guard')

export const DEFAULT_CONFIG_PATH = join(AUTO_GUARD_DIR, 'config.json')

export function defaultConfig(): GuardConfig {
  return defaultGuardConfig(AUTO_GUARD_DIR)
}

export function loadConfig(userPath: string = DEFAULT_CONFIG_PATH): GuardConfig {
  return loadCoreConfig(userPath, defaultConfig())
}

export function saveConfig(config: GuardConfig, userPath: string = DEFAULT_CONFIG_PATH): void {
  saveCoreConfig(config, userPath)
}
