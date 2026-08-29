/**
 * OpenCode host config root (ADR-0003): `~/.config/opencode/auto-guard/`.
 *
 * One independent config root per host; OpenCode's own config lives next
 * door in `~/.config/opencode/opencode.json` (written by the installer).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultGuardConfig, loadConfig as loadCoreConfig, saveConfig as saveCoreConfig } from '@auto-guard/core'
import type { GuardConfig } from '@auto-guard/core'

/** The opencode config root: `~/.config/opencode/auto-guard`. */
export const AUTO_GUARD_DIR = join(homedir(), '.config', 'opencode', 'auto-guard')

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
