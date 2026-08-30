/**
 * Per-host config space (ADR-0003): core config mechanics rooted at the
 * descriptor's config root under the user's home (`~/.zcode/auto-guard`,
 * `~/.claude/auto-guard`, …). Paths are unchanged from the pre-runtime hosts
 * so existing users keep their rules, caches and audit data with zero
 * migration.
 *
 * `home` is injectable so the contract tests can root everything in a temp
 * directory without module mocks.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultGuardConfig, loadConfig as loadCoreConfig, saveConfig as saveCoreConfig } from '@auto-guard/core'
import type { GuardConfig } from '@auto-guard/core'
import type { HostDescriptor } from './descriptor.ts'

export interface HostConfigSpace {
  /** The host config root, e.g. `~/.zcode/auto-guard`. */
  autoGuardDir: string
  /** `config.json` inside the root. */
  defaultConfigPath: string
  /** Human-facing path used in messages: `~/.zcode/auto-guard/config.json`. */
  configPathLabel: string
  defaultConfig(): GuardConfig
  loadConfig(userPath?: string): GuardConfig
  saveConfig(config: GuardConfig, userPath?: string): void
}

export function createConfigSpace(descriptor: HostDescriptor, home?: string): HostConfigSpace {
  const autoGuardDir = join(home ?? homedir(), ...descriptor.configRootSegments)
  const defaultConfigPath = join(autoGuardDir, 'config.json')
  return {
    autoGuardDir,
    defaultConfigPath,
    configPathLabel: `~/${descriptor.configRootSegments.join('/')}/config.json`,
    defaultConfig: () => defaultGuardConfig(autoGuardDir),
    loadConfig: (userPath = defaultConfigPath) => loadCoreConfig(userPath, defaultGuardConfig(autoGuardDir)),
    saveConfig: (config: GuardConfig, userPath = defaultConfigPath) => saveCoreConfig(config, userPath),
  }
}
