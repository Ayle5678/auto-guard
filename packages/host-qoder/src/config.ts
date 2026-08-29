/**
 * Qoder host config root (ADR-0003): `~/.qoder/auto-guard/`.
 *
 * Wraps the core config mechanics with the qoder-specific root directory —
 * one independent config root per host, so a Qoder user's rules never leak
 * into (or get shadowed by) another host's guard state.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultGuardConfig, loadConfig as loadCoreConfig, saveConfig as saveCoreConfig } from '@auto-guard/core'
import type { GuardConfig } from '@auto-guard/core'

/** The qoder config root: `~/.qoder/auto-guard`. */
export const AUTO_GUARD_DIR = join(homedir(), '.qoder', 'auto-guard')

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
