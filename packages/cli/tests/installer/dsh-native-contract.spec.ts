/**
 * The dsh native channel contract, pinned against the real `dsh` CLI
 * (2026-08 diagnosis of `init` failing with "required option '--profile
 * <name>' not specified"): `dsh plugin` is a pnpm forwarder scoped by its
 * own required `--profile <name>` (rejected as a parent option), and dsh
 * reconciles the profile's `dsh.profile.bundles` layer list from each
 * dependency's `dsh.bundle` manifest declaration. The installer argv and
 * the adapter manifest identity must both match, or dsh either refuses the
 * command or installs the adapter as an unloaded plain dependency.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileById } from '../../src/installer/profiles.ts'

const HOST_DSH_PKG = fileURLToPath(new URL('../../../host-dsh/package.json', import.meta.url))

describe('dsh native channel contract', () => {
  it('argv carries --profile web after the plugin subcommand, dsh-required shapes', () => {
    const action = profileById('dsh')!.action
    if (action.kind !== 'command') throw new Error('dsh action must be a command action')
    // `link:` installs a symlink (the adapter resolves its workspace deps
    // from the monorepo); a bare dir would make pnpm pack it and choke on
    // `workspace:*`. `ls <name>` filters by exact name, so the legacy
    // standalone `dsh-auto-guard` plugin can never masquerade as ours.
    expect(action.installArgs).toEqual(['plugin', '--profile', 'web', 'add', 'link:${AUTO_GUARD_DSH_DIR}'])
    expect(action.removeArgs).toEqual(['plugin', '--profile', 'web', 'remove', 'auto-guard'])
    expect(action.listArgs).toEqual(['plugin', '--profile', 'web', 'ls', '--depth=0', 'auto-guard'])
    expect(action.pluginId).toBe('auto-guard')
  })

  it('adapter manifest registers as a dsh bundle named auto-guard', () => {
    const manifest = JSON.parse(readFileSync(HOST_DSH_PKG, 'utf8')) as {
      name: string
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.name).toBe('auto-guard')
    expect(manifest.dsh?.bundle?.patch).toBeTruthy()
    expect(existsSync(join(HOST_DSH_PKG, '..', manifest.dsh?.bundle?.patch ?? ''))).toBe(true)
  })
})
