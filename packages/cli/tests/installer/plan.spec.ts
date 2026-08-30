import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildInitPlan } from '../../src/installer/plan.ts'
import { applyHostPlan } from '../../src/installer/plan.ts'
import { profileById, type PackagePaths } from '../../src/installer/profiles.ts'

const home = 'C:/fake-home'
const paths: PackagePaths = {
  pi: { srcIndex: 'C:/pkg/host-pi/src/index.ts' },
  zcode: { distHookCli: 'C:/pkg/host-zcode/dist/hook-cli.js', distSessionStart: 'C:/pkg/host-zcode/dist/session-start.js' },
  dsh: { packageDir: 'C:/pkg/host-dsh' },
  claude: { distHookCli: 'C:/pkg/host-claude/dist/hook-cli.js', distSessionStart: 'C:/pkg/host-claude/dist/session-start.js' },
  opencode: { distPluginDir: 'C:/pkg/host-opencode/dist' },
  qoder: { distHookCli: 'C:/pkg/host-qoder/dist/hook-cli.js', distSessionStart: 'C:/pkg/host-qoder/dist/session-start.js' },
  codex: { distHookCli: 'C:/pkg/host-codex/dist/hook-cli.js', distSessionStart: 'C:/pkg/host-codex/dist/session-start.js' },
}

describe('buildInitPlan as a pure function (spec 0002 Testing Decisions)', () => {
  it('empty snapshot → single write step, no backup, diff lists the added entry', () => {
    const plan = buildInitPlan(profileById('pi')!, { home, paths, readFile: () => null })
    expect(plan.blocked).toBeUndefined()
    expect(plan.skipped).toBeUndefined()
    expect(plan.steps.map((s) => s.kind)).toEqual(['write'])
    expect(plan.steps[0]!.targetFile).toBe(join(home, '.pi', 'agent', 'settings.json'))
    expect(plan.diff[0]).toContain('host-pi/src/index.ts')
  })

  it('snapshot with existing user content → backup then write, user keys preserved', () => {
    const plan = buildInitPlan(profileById('pi')!, {
      home,
      paths,
      readFile: (p) => (p.endsWith('settings.json') ? '{"pi":{"extensions":["mine.ts"]},"theme":"dark"}' : null),
    })
    expect(plan.steps.map((s) => s.kind)).toEqual(['backup', 'write'])
    const doc = JSON.parse(plan.steps[1]!.content!) as { theme: string; pi: { extensions: string[] } }
    expect(doc.theme).toBe('dark')
    expect(doc.pi.extensions).toEqual(['mine.ts', paths.pi.srcIndex])
    expect(plan.diff).toHaveLength(1)
  })

  it('snapshot already containing the marker → skipped, zero steps', () => {
    const plan = buildInitPlan(profileById('pi')!, {
      home,
      paths,
      readFile: () => JSON.stringify({ pi: { extensions: [paths.pi.srcIndex] } }),
    })
    expect(plan.skipped).toBe('已接入，跳过')
    expect(plan.steps).toEqual([])
  })

  it('unparseable snapshot → blocked with a refusal, zero steps', () => {
    const plan = buildInitPlan(profileById('pi')!, { home, paths, readFile: () => 'not json{' })
    expect(plan.blocked).toContain('无法解析')
    expect(plan.steps).toEqual([])
  })

  it('zcode plan renders both hook entries, ensures hooks.enabled and requires its built artifacts', () => {
    const plan = buildInitPlan(profileById('zcode')!, { home, paths, readFile: () => null })
    expect(plan.steps.map((s) => s.kind)).toEqual(['write'])
    expect(plan.diff).toHaveLength(3)
    expect(plan.diff).toContain('+ hooks.enabled = true')
    expect(plan.diff.join('\n')).toContain('hook-cli.js')
    expect(plan.diff.join('\n')).toContain('session-start.js')
  })

  it('claude plan writes the Claude Code dialect into settings.json', () => {
    const plan = buildInitPlan(profileById('claude')!, {
      home,
      paths,
      readFile: () => '{"model":"opus","hooks":{"PreToolUse":[{"matcher":"Grep","hooks":[{"type":"command","command":"mine.sh"}]}]}}',
    })
    expect(plan.blocked).toBeUndefined()
    expect(plan.steps.map((s) => s.kind)).toEqual(['backup', 'write'])
    const doc = JSON.parse(plan.steps[1]!.content!) as {
      model: string
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }> }
    }
    expect(doc.model).toBe('opus')
    // User hook groups come first; auto-guard's matcher group is appended.
    expect(doc.hooks.PreToolUse[0]!.matcher).toBe('Grep')
    const ours = doc.hooks.PreToolUse[1]!
    expect(ours.matcher).toBe('^(Bash|Read|Write|Edit|NotebookEdit)$')
    expect(ours.hooks[0]!.type).toBe('command')
    expect(ours.hooks[0]!.command).toBe(`node "${paths.claude.distHookCli}"`)
  })

  it('claude plan is idempotent when the marker entries already exist', () => {
    const existing = buildInitPlan(profileById('claude')!, { home, paths, readFile: () => null })
    const doc = JSON.parse(existing.steps[0]!.content!) as Record<string, unknown>
    const again = buildInitPlan(profileById('claude')!, { home, paths, readFile: () => JSON.stringify(doc) })
    expect(again.skipped).toBe('已接入，跳过')
  })

  it('opencode plan appends the plugin path and seeds permission rules at FIRST position', () => {
    const plan = buildInitPlan(profileById('opencode')!, {
      home,
      paths,
      readFile: () => JSON.stringify({ $schema: 'x', plugin: [], permission: { bash: { 'git status': 'allow' } } }),
    })
    expect(plan.blocked).toBeUndefined()
    expect(plan.steps.map((s) => s.kind)).toEqual(['backup', 'write'])
    const doc = JSON.parse(plan.steps[1]!.content!) as {
      plugin: string[]
      permission: Record<string, Record<string, string>>
    }
    expect(doc.plugin).toEqual([paths.opencode.distPluginDir])
    // "*" FIRST: opencode is last-matching-rule-wins, user rules must win.
    expect(Object.keys(doc.permission.bash!)[0]).toBe('*')
    expect(doc.permission.bash).toEqual({ '*': 'ask', 'git status': 'allow' })
    expect(doc.permission.edit).toEqual({ '*': 'ask' })
    expect(doc.permission.read).toEqual({ '*': 'ask' })
  })

  it('opencode plan tolerates all three shapes idempotently (empty / partial / already-asked)', () => {
    const shapes = ['{}', '{"permission":{"bash":{"*":"ask"}}}', '{"permission":{"bash":"allow"}}']
    const results = shapes.map((snapshot) => buildInitPlan(profileById('opencode')!, { home, paths, readFile: () => snapshot }))
    // Empty and already-"*" documents only miss the plugin entry.
    expect(results[0]!.diff.some((d) => d.includes('permission.bash'))).toBe(true)
    expect(results[1]!.diff.some((d) => d.includes('permission.bash'))).toBe(false)
    // A global string action is never overwritten — noted, not written.
    expect(results[2]!.diff.join('\n')).toContain('permission.bash 已是全局动作')
    const doc = JSON.parse(results[2]!.steps[results[2]!.steps.length - 1]!.content!) as { permission: Record<string, unknown> }
    expect(doc.permission.bash).toBe('allow')
  })

  it('command profile renders the native channel argv with the package dir', () => {
    const plan = buildInitPlan(profileById('dsh')!, { home, paths, readFile: () => null })
    expect(plan.steps[0]!.kind).toBe('run-command')
    expect(plan.steps[0]!.command).toEqual({ executable: 'dsh', args: ['plugin', '--profile', 'web', 'add', `link:${paths.dsh.packageDir}`] })
  })
})

describe('applyHostPlan against an injected runner', () => {
  it('names the failing step when the native command exits non-zero', () => {
    const plan = buildInitPlan(profileById('dsh')!, { home, paths })
    const outcome = applyHostPlan(plan, { runCommand: () => ({ ok: false, stderr: 'boom' }) })
    expect(outcome).toEqual({ ok: false, failedStep: 'run-command', error: 'boom' })
  })
})

describe('zcode hooks.events contract (v0.3.0 regression guard)', () => {
  it('win32 escaped paths still match the marker after the JSON round-trip', () => {
    // The file on disk stores `D:\\old\\...`; JSON.parse gives single
    // backslashes; the old per-char normalizePath turned the re-stringified
    // form into `//` and never matched, so init appended forever.
    const damaged = {
      hooks: {
        enabled: true,
        PreToolUse: [{ matcher: 'x', hooks: [{ type: 'process', command: 'node', args: ['D:\\old\\auto-guard\\packages\\host-zcode\\dist\\hook-cli.js'] }] }],
      },
      theme: 'dark',
    }
    const plan = buildInitPlan(profileById('zcode')!, { home, paths, readFile: () => JSON.stringify(damaged) })
    expect(plan.blocked).toBeUndefined()
    // 2 appended events entries + 1 stale flat entry cleaned up; enabled stays untouched.
    expect(plan.diff).toHaveLength(3)
    expect(plan.diff.join('\n')).toContain('host-zcode/dist/hook-cli.js')
    const doc = JSON.parse(plan.steps.at(-1)!.content!) as {
      theme: string
      hooks: { enabled: boolean; events: { PreToolUse: unknown[]; SessionStart: unknown[] }; PreToolUse?: unknown[] }
    }
    expect(doc.theme).toBe('dark')
    expect(doc.hooks.enabled).toBe(true)
    expect(doc.hooks.events.PreToolUse).toHaveLength(1)
    expect(doc.hooks.events.SessionStart).toHaveLength(1)
    expect(doc.hooks.PreToolUse).toBeUndefined()
  })

  it('adds hooks.enabled=true when missing — configuration-file hooks are opt-in', () => {
    const plan = buildInitPlan(profileById('zcode')!, { home, paths, readFile: () => '{"theme":"dark"}' })
    expect(plan.diff).toContain('+ hooks.enabled = true')
    const doc = JSON.parse(plan.steps.at(-1)!.content!) as { hooks: { enabled: boolean } }
    expect(doc.hooks.enabled).toBe(true)
  })

  it('blocks when the ensure path collides with a non-object', () => {
    const profile = {
      id: 'zcode',
      label: 'ZCode',
      sessionNote: 'sessionNoteHooksNoHotReload',
      detection: { dirs: ['.zcode'], files: [], executables: [] },
      action: {
        kind: 'json-merge',
        file: '~/.zcode/cli/config.json',
        ops: [{ arrayPath: ['unrelated', 'arr'], template: '"mine.ts"', markerSuffix: '/mine.ts' }],
        ensure: [{ path: ['hooks', 'enabled'], value: true }],
      },
    } as unknown as Parameters<typeof buildInitPlan>[0]
    const plan = buildInitPlan(profile, { home, paths, readFile: () => '{"hooks":"corrupt"}' })
    expect(plan.blocked).toContain('不是对象')
    expect(plan.steps).toEqual([])
  })

  it('fully repaired config → skipped with zero steps (idempotent)', () => {
    const entry = (file: string) => ({ matcher: 'x', hooks: [{ type: 'process', command: 'node', args: [`C:/pkg/host-zcode/dist/${file}`] }] })
    const repaired = {
      hooks: {
        enabled: true,
        events: { PreToolUse: [entry('hook-cli.js')], SessionStart: [entry('session-start.js')] },
      },
    }
    const plan = buildInitPlan(profileById('zcode')!, { home, paths, readFile: () => JSON.stringify(repaired) })
    expect(plan.skipped).toBe('已接入，跳过')
    expect(plan.steps).toEqual([])
  })
})
