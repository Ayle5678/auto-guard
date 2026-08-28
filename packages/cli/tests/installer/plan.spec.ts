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

  it('zcode plan renders both hook entries and requires its built artifacts', () => {
    const plan = buildInitPlan(profileById('zcode')!, { home, paths, readFile: () => null })
    expect(plan.steps.map((s) => s.kind)).toEqual(['write'])
    expect(plan.diff).toHaveLength(2)
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
    expect(plan.steps[0]!.command).toEqual({ executable: 'dsh', args: ['plugin', 'add', paths.dsh.packageDir] })
  })
})

describe('applyHostPlan against an injected runner', () => {
  it('names the failing step when the native command exits non-zero', () => {
    const plan = buildInitPlan(profileById('dsh')!, { home, paths })
    const outcome = applyHostPlan(plan, { runCommand: () => ({ ok: false, stderr: 'boom' }) })
    expect(outcome).toEqual({ ok: false, failedStep: 'run-command', error: 'boom' })
  })
})
