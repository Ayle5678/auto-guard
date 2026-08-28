import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../src/shell.ts'
import { LightAuditStore } from '@auto-guard/core'
import type { AuditStore, GuardConfig } from '@auto-guard/core'
import type { PingableReviewer } from '../src/shell.ts'

const dirs: string[] = []
function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cli-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const fakeAudit = (): AuditStore => new LightAuditStore(join(mkTempForAudit(), 'audit.db'))
const auditDirs: string[] = []
function mkTempForAudit(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cli-audit-'))
  auditDirs.push(d)
  return d
}
// extend afterEach to also clean audit dirs
afterEach(() => {
  while (auditDirs.length) rmSync(auditDirs.pop()!, { recursive: true, force: true })
})

const fakeReviewer = (): PingableReviewer => ({
  async review() {
    return { decision: 'allow', risk: 'low', reason: 'fake' }
  },
  async ping() {
    return { ok: true }
  },
})

const deps: CliDeps = { makeReviewer: fakeReviewer, makeAudit: fakeAudit, detectRoot: () => undefined }

describe('cli: config root resolution', () => {
  it('refuses to run without a resolvable config root', async () => {
    const result = await runCli(['guard', 'status'], { ...deps })
    expect(result.code).toBe(2)
    expect(result.output[0]).toContain('--config-root')
  })

  it('accepts --config-root anywhere in argv', async () => {
    const dir = root()
    const on = await runCli(['--config-root', dir, 'guard', 'on'], deps)
    expect(on.code).toBe(0)
    expect(existsSync(join(dir, 'config.json'))).toBe(true)
  })
})

describe('cli: aggregate guard status (auto-detected root)', () => {
  it('renders every installed host: seeded root in full, unseeded as a hint, absent host skipped', async () => {
    const absent = root()
    const piHome = root()
    const piRoot = join(piHome, 'auto-guard') // deliberately never created
    const zc = root()
    const zcHome = join(zc, '.zcode')
    const zcRoot = join(zcHome, 'auto-guard')
    mkdirSync(zcRoot, { recursive: true })
    writeFileSync(join(zcRoot, 'config.json'), JSON.stringify({ enabled: true, examineEnabled: false }), 'utf8')
    writeFileSync(
      join(zcRoot, 'status.json'),
      JSON.stringify({ lastRunAt: new Date(2026, 7, 28, 10, 0, 0).toISOString(), lastTool: 'Bash', lastDecisionKind: 'allow', lastDecisionSource: 'static-allow' }),
      'utf8',
    )

    const result = await runCli(['guard', 'status'], {
      ...deps,
      detectRoot: () => piHome, // any auto-detected root; aggregate ignores it
      hostRoots: () => [
        { label: 'DeepSeek Harness', homeDir: join(absent, 'dsh'), root: join(absent, 'dsh', 'auto-guard') },
        { label: 'Pi Coding Agent', homeDir: piHome, root: piRoot },
        { label: 'ZCode', homeDir: zcHome, root: zcRoot },
      ],
    })

    const text = result.output.join('\n')
    expect(result.code).toBe(0)
    expect(text).toContain('多宿主状态')
    expect(text).toContain('尚未播种')
    expect(text).not.toContain('DeepSeek Harness —') // absent host row is skipped entirely
    expect(text).toContain('ZCode')
    expect(text).toContain('enabled : true')
    expect(text).toContain('last    : Bash → allow [static-allow]')
    expect(text).toContain('--config-root')
    expect(existsSync(piRoot)).toBe(false) // aggregate status must not seed anything
  })

  it('explicit --config-root keeps the single-root view', async () => {
    const dir = root()
    const result = await runCli(['--config-root', dir, 'guard', 'status'], deps)
    expect(result.code).toBe(0)
    const text = result.output.join('\n')
    expect(text).toContain('enabled : true')
    expect(text).not.toContain('多宿主状态')
  })
})

describe('cli: guard group over fake deps', () => {
  it('on/off round-trips through config.json', async () => {
    const dir = root()
    await runCli(['--config-root', dir, 'guard', 'off'], deps)
    expect((await runCli(['--config-root', dir, 'guard', 'status'], deps)).output.join('\n')).toContain('enabled : false')
    await runCli(['--config-root', dir, 'guard', 'on'], deps)
    expect((await runCli(['--config-root', dir, 'guard', 'status'], deps)).output.join('\n')).toContain('enabled : true')
  })

  it('recent renders recorded decisions from the host status store', async () => {
    const dir = root()
    appendFileSync(
      join(dir, 'decision-history.jsonl'),
      `${JSON.stringify({ lastRunAt: new Date(2026, 7, 28, 10, 0, 0).toISOString(), lastTool: 'Bash', lastCommand: 'ls', lastDecisionKind: 'allow', lastDecisionSource: 'static-allow' })}\n`,
      'utf8',
    )
    const result = await runCli(['--config-root', dir, 'guard', 'recent'], deps)
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('ls')
  })

  it('stats gates on examine and pings through the injected reviewer', async () => {
    const dir = root()
    const off = await runCli(['--config-root', dir, 'guard', 'stats'], deps)
    expect(off.output.join('\n')).toContain('审查日志未开启')
    await runCli(['--config-root', dir, 'examine', 'on'], deps)
    const on = await runCli(['--config-root', dir, 'guard', 'stats'], deps)
    expect(on.output.join('\n')).toContain('审计库记录总数')
    const ping = await runCli(['--config-root', dir, 'guard', 'ping'], deps)
    expect(ping.code).toBe(0)
    expect(ping.output.join('\n')).toContain('API 联通成功')
  })
})

describe('cli: set + examine + optimize groups over fake deps', () => {
  it('set-api + history persist config changes without any host SDK', async () => {
    const dir = root()
    const setApi = await runCli(['--config-root', dir, 'set', 'set-api', 'base', 'https://example.com'], deps)
    expect(setApi.code).toBe(0)
    const history = await runCli(['--config-root', dir, 'set', 'history', 'on'], deps)
    expect(history.code).toBe(0)
    const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as GuardConfig
    expect(written.apiBase).toBe('https://example.com')
    expect(written.historyEnabled).toBe(true)
    expect((await runCli(['--config-root', dir, 'set', 'show-key'], deps)).output.join('\n')).toContain('legacy')
    expect((await runCli(['--config-root', dir, 'set', 'set-key'], deps)).code).toBe(2)
  })

  it('examine on/off/clear work against the injected audit factory', async () => {
    const dir = root()
    expect((await runCli(['--config-root', dir, 'examine', 'on'], deps)).code).toBe(0)
    expect((await runCli(['--config-root', dir, 'examine', 'status'], deps)).output.join('\n')).toContain('examineEnabled: true')
    expect((await runCli(['--config-root', dir, 'examine', 'clear-old'], deps)).code).toBe(0)
    expect((await runCli(['--config-root', dir, 'examine', 'off'], deps)).code).toBe(0)
  })

  it('optimize analyze/list/rollback run with fake audit and no network', async () => {
    const dir = root()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ examineEnabled: true }), 'utf8')
    const analyze = await runCli(['--config-root', dir, 'optimize', 'analyze'], deps)
    expect(analyze.code).toBe(0)
    expect((await runCli(['--config-root', dir, 'optimize', 'list'], deps)).output.join('\n')).toContain('(无学习规则)')
    expect((await runCli(['--config-root', dir, 'optimize', 'rollback'], deps)).code).toBe(2)
    expect((await runCli(['--config-root', dir, 'optimize', 'status'], deps)).output.join('\n')).toContain('autoAnalyzeEnabled')
  })
})
