import { describe, expect, it } from 'vitest'
import { HOST_IDS, PROFILES, profileById, renderTemplate, validateProfile } from '../../src/installer/profiles.ts'

describe('host profiles (ADR-0008)', () => {
  it('declares exactly dsh / pi / zcode', () => {
    expect(HOST_IDS).toEqual(['dsh', 'pi', 'zcode'])
    expect(PROFILES.map((p) => p.id)).toEqual(['dsh', 'pi', 'zcode'])
  })

  it('all shipped profiles pass schema validation', () => {
    for (const profile of PROFILES) {
      expect(validateProfile(profile)).toEqual([])
    }
  })

  it('rejects a profile with missing fields', () => {
    const broken = { id: 'pi', label: 'Pi' } as unknown as (typeof PROFILES)[number]
    const errors = validateProfile(broken)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('detection'))).toBe(true)
  })

  it('rejects unknown host ids and structurally broken actions', () => {
    const unknown = { ...profileById('pi')!, id: 'nope' } as unknown as (typeof PROFILES)[number]
    expect(validateProfile(unknown)).toContain('id 必须是 dsh|pi|zcode 之一')
    const commandWithoutArgs = { kind: 'command', executable: '', installArgs: [], removeArgs: [], listArgs: [], pluginId: '' }
    const brokenCommand = { ...profileById('pi')!, action: commandWithoutArgs } as unknown as (typeof PROFILES)[number]
    expect(validateProfile(brokenCommand)).toContain('command 动作缺少 executable')
    const badToken = JSON.parse(JSON.stringify(profileById('zcode')!)) as (typeof PROFILES)[number]
    if (badToken.action.kind === 'json-merge') badToken.action.requiredTokens = ['${AUTO_GUARD_NOPE}']
    expect(validateProfile(badToken)).toContain('requiredTokens 含未知 token：${AUTO_GUARD_NOPE}')
  })

  it('json-merge profiles target one file and carry marker suffixes', () => {
    const pi = profileById('pi')!
    expect(pi.action.kind).toBe('json-merge')
    if (pi.action.kind === 'json-merge') {
      expect(pi.action.file).toBe('~/.pi/agent/settings.json')
      expect(pi.action.ops.every((op) => op.markerSuffix.length > 0)).toBe(true)
    }
    const zcode = profileById('zcode')!
    if (zcode.action.kind === 'json-merge') {
      expect(zcode.action.file).toBe('~/.zcode/cli/config.json')
      expect(zcode.action.ops.map((op) => op.arrayPath.join('.'))).toEqual(['hooks.PreToolUse', 'hooks.SessionStart'])
    }
  })

  it('templates resolve every ${TOKEN} against the package paths', () => {
    const paths = {
      pi: { srcIndex: 'C:/x/packages/host-pi/src/index.ts' },
      zcode: { distHookCli: 'C:/x/packages/host-zcode/dist/hook-cli.js', distSessionStart: 'C:/x/packages/host-zcode/dist/session-start.js' },
      dsh: { packageDir: 'C:/x/packages/host-dsh' },
    }
    for (const profile of PROFILES) {
      if (profile.action.kind === 'json-merge') {
        for (const op of profile.action.ops) {
          // Function templates must render valid, token-free JSON in every language.
          for (const lang of ['zh', 'en'] as const) {
            const template = typeof op.template === 'function' ? op.template(lang) : op.template
            const rendered = renderTemplate(template, paths)
            expect(rendered).not.toMatch(/\$\{[A-Z_]+\}/)
            expect(() => JSON.parse(rendered)).not.toThrow()
          }
        }
      }
    }
  })

  it('zcode PreToolUse template mirrors the shipped hooks.json shape', () => {
    const zcode = profileById('zcode')!
    if (zcode.action.kind !== 'json-merge') throw new Error('expected json-merge')
    const op0 = zcode.action.ops[0]!
    const template = typeof op0.template === 'function' ? op0.template('zh') : op0.template
    const rendered = JSON.parse(renderTemplate(template, {
      pi: { srcIndex: '' },
      zcode: { distHookCli: '/opt/ag/host-zcode/dist/hook-cli.js', distSessionStart: '' },
      dsh: { packageDir: '' },
    })) as { matcher: string; hooks: Array<{ type: string; command: string; args: string[]; timeoutMs: number }> }
    expect(rendered.matcher).toBe('^(Bash|Read|Write|Edit|ApplyPatch)$')
    expect(rendered.hooks[0]).toMatchObject({ type: 'process', command: 'node', args: ['/opt/ag/host-zcode/dist/hook-cli.js'] })
  })

  it('dsh action shells out to the native plugin channel', () => {
    const dsh = profileById('dsh')!
    expect(dsh.action.kind).toBe('command')
    if (dsh.action.kind === 'command') {
      expect(dsh.action.installArgs).toEqual(['plugin', '--profile', 'web', 'add', 'link:${AUTO_GUARD_DSH_DIR}'])
      expect(dsh.action.removeArgs).toEqual(['plugin', '--profile', 'web', 'remove', 'auto-guard'])
      expect(dsh.action.listArgs).toEqual(['plugin', '--profile', 'web', 'ls', '--depth=0', 'auto-guard'])
    }
  })
})
