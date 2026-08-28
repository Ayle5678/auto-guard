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
