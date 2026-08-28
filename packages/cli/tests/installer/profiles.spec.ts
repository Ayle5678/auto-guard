import { describe, expect, it } from 'vitest'
import { HOST_IDS, PROFILES, profileById, renderTemplate, validateProfile, type PackagePaths } from '../../src/installer/profiles.ts'

const fullPaths = (): PackagePaths => ({
  pi: { srcIndex: 'C:/x/packages/host-pi/src/index.ts' },
  zcode: { distHookCli: 'C:/x/packages/host-zcode/dist/hook-cli.js', distSessionStart: 'C:/x/packages/host-zcode/dist/session-start.js' },
  dsh: { packageDir: 'C:/x/packages/host-dsh' },
  claude: { distHookCli: 'C:/x/packages/host-claude/dist/hook-cli.js', distSessionStart: 'C:/x/packages/host-claude/dist/session-start.js' },
  opencode: { distPluginDir: 'C:/x/packages/host-opencode/dist' },
})

describe('host profiles (ADR-0008)', () => {
  it('declares exactly dsh / pi / zcode / claude / opencode', () => {
    expect(HOST_IDS).toEqual(['dsh', 'pi', 'zcode', 'claude', 'opencode'])
    expect(PROFILES.map((p) => p.id)).toEqual(['dsh', 'pi', 'zcode', 'claude', 'opencode'])
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
    expect(validateProfile(unknown)[0]).toMatch(/^id 必须是 dsh\|pi\|zcode\|claude\|opencode 之一$/)
    const commandWithoutArgs = { kind: 'command', executable: '', installArgs: [], removeArgs: [], listArgs: [], pluginId: '' }
    const brokenCommand = { ...profileById('pi')!, action: commandWithoutArgs } as unknown as (typeof PROFILES)[number]
    expect(validateProfile(brokenCommand)).toContain('command 动作缺少 executable')
    const badToken = JSON.parse(JSON.stringify(profileById('zcode')!)) as (typeof PROFILES)[number]
    if (badToken.action.kind === 'json-merge') badToken.action.requiredTokens = ['${AUTO_GUARD_NOPE}']
    expect(validateProfile(badToken)).toContain('requiredTokens 含未知 token：${AUTO_GUARD_NOPE}')
    const badPermissionOp = JSON.parse(JSON.stringify(profileById('opencode')!)) as (typeof PROFILES)[number]
    if (badPermissionOp.action.kind === 'json-merge' && badPermissionOp.action.ops[1]!.kind === 'permission-ask-rules') {
      badPermissionOp.action.ops[1]!.tools = []
    }
    expect(validateProfile(badPermissionOp)).toContain('permission-ask-rules 缺少 tools')
  })

  it('json-merge profiles target one file and carry marker suffixes', () => {
    const pi = profileById('pi')!
    expect(pi.action.kind).toBe('json-merge')
    if (pi.action.kind === 'json-merge') {
      expect(pi.action.file).toBe('~/.pi/agent/settings.json')
      expect(pi.action.ops.every((op) => op.kind === 'array-append' && op.markerSuffix.length > 0)).toBe(true)
    }
    const zcode = profileById('zcode')!
    if (zcode.action.kind === 'json-merge') {
      expect(zcode.action.file).toBe('~/.zcode/cli/config.json')
      expect(zcode.action.ops.map((op) => (op.kind === 'array-append' ? op.arrayPath.join('.') : op.kind))).toEqual(['hooks.PreToolUse', 'hooks.SessionStart'])
    }
  })

  it('claude profile mirrors zcode but speaks the Claude Code settings dialect', () => {
    const claude = profileById('claude')!
    expect(claude.action.kind).toBe('json-merge')
    if (claude.action.kind !== 'json-merge') throw new Error('expected json-merge')
    expect(claude.action.file).toBe('~/.claude/settings.json')
    const ops = claude.action.ops.filter((op): op is Extract<typeof op, { kind: 'array-append' }> => op.kind === 'array-append')
    expect(ops.map((op) => op.arrayPath.join('.'))).toEqual(['hooks.PreToolUse', 'hooks.SessionStart'])
    expect(claude.action.requiredTokens).toEqual(['${AUTO_GUARD_CLAUDE_HOOK_CLI}', '${AUTO_GUARD_CLAUDE_SESSION_START}'])
    expect(claude.postInstallNotes?.length).toBeGreaterThanOrEqual(2)
    const paths = fullPaths()
    const preToolUse = JSON.parse(renderTemplate(ops[0]!.template, paths)) as {
      matcher: string
      hooks: Array<{ type: string; command: string; timeout: number }>
    }
    expect(preToolUse.matcher).toBe('^(Bash|Read|Write|Edit|NotebookEdit)$')
    expect(preToolUse.hooks[0]!.type).toBe('command')
    expect(preToolUse.hooks[0]!.command).toBe(`node "${paths.claude.distHookCli}"`)
    expect(typeof preToolUse.hooks[0]!.timeout).toBe('number')
    const sessionStart = JSON.parse(renderTemplate(ops[1]!.template, paths)) as { matcher: string }
    expect(sessionStart.matcher).toBe('^(startup|resume)$')
  })

  it('opencode profile appends the plugin path and asks on bash/edit/read', () => {
    const opencode = profileById('opencode')!
    expect(opencode.action.kind).toBe('json-merge')
    if (opencode.action.kind !== 'json-merge') throw new Error('expected json-merge')
    expect(opencode.action.file).toBe('~/.config/opencode/opencode.json')
    const pluginOp = opencode.action.ops[0]!
    if (pluginOp.kind !== 'array-append') throw new Error('expected array-append')
    expect(pluginOp.arrayPath).toEqual(['plugin'])
    expect(pluginOp.markerSuffix).toBe('/host-opencode/dist')
    expect(JSON.parse(renderTemplate(pluginOp.template, fullPaths()))).toBe('C:/x/packages/host-opencode/dist')
    const permissionOp = opencode.action.ops[1]!
    if (permissionOp.kind !== 'permission-ask-rules') throw new Error('expected permission-ask-rules')
    expect(permissionOp.tools).toEqual(['bash', 'edit', 'read'])
    expect(permissionOp.action).toBe('ask')
  })

  it('templates resolve every ${TOKEN} against the package paths', () => {
    const paths = fullPaths()
    for (const profile of PROFILES) {
      if (profile.action.kind === 'json-merge') {
        for (const op of profile.action.ops) {
          if (op.kind !== 'array-append') continue
          const rendered = renderTemplate(op.template, paths)
          expect(rendered).not.toMatch(/\$\{[A-Z_]+\}/)
          expect(() => JSON.parse(rendered)).not.toThrow()
        }
      }
    }
  })

  it('zcode PreToolUse template mirrors the shipped hooks.json shape', () => {
    const zcode = profileById('zcode')!
    if (zcode.action.kind !== 'json-merge') throw new Error('expected json-merge')
    const op = zcode.action.ops[0]!
    if (op.kind !== 'array-append') throw new Error('expected array-append')
    const rendered = JSON.parse(renderTemplate(op.template, {
      ...fullPaths(),
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
      expect(dsh.action.installArgs).toEqual(['plugin', 'add', '${AUTO_GUARD_DSH_DIR}'])
      expect(dsh.action.removeArgs).toEqual(['plugin', 'remove', 'dsh-auto-guard'])
      expect(dsh.action.listArgs).toEqual(['plugin', 'list'])
    }
  })
})
