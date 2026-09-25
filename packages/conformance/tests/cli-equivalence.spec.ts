/**
 * Cross-entry CLI behavior snapshots (SPEC 0020 / ADR-0022, ticket 01).
 *
 * The unified management CLI (@auto-guard/cli runCli) and the host-runtime CLI
 * (createCliMain) pin their CURRENT behavior here — command dispatch, output
 * and exit codes per action, including each entry's unique capabilities (the
 * aggregate view on the cli side, the ask group and the set-key wizard on the
 * runtime side). The single-engine refactor may only touch construction
 * calls in this file; any behavioral drift turns these red.
 *
 * `guard ping` is pinned through the injectable reviewer only — the network
 * itself stays out of the snapshot.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LightAuditStore } from '@auto-guard/core'
import { runCli, type CliDeps } from '@auto-guard/cli/shell'
import type { PingResult } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from '@auto-guard/host-zcode/src/descriptor.ts'

const dirs: string[] = []
const auditDirs: string[] = []
afterEach(() => {
  while (auditDirs.length) rmSync(auditDirs.pop()!, { recursive: true, force: true })
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true })
    } catch {
      // Windows may hold handles briefly; the OS temp cleaner wins.
    }
  }
})

function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-cli-snap-'))
  dirs.push(d)
  return d
}

const fakeAudit = (): LightAuditStore => {
  const d = mkdtempSync(join(tmpdir(), 'ag-cli-snap-audit-'))
  auditDirs.push(d)
  return new LightAuditStore(join(d, 'audit.db'))
}

/** Seed a config root with `enabled: true` so guard commands see a live guard. */
function seedRoot(dir: string, extra: Record<string, unknown> = {}): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ enabled: true, ...extra }), 'utf8')
}

/** Runtime-side capture: createCliMain with a temp-rooted zcode config space. */
async function withRuntimeCli(fn: (args: (argv: readonly string[]) => Promise<{ code: number; out: string }>, dir: string) => Promise<void>, opts: { ping?: () => Promise<PingResult> } = {}): Promise<void> {
  const { createConfigSpace, createCliMain, createBootstrap, createHostMessage } = await import('@auto-guard/host-runtime')
  const dir = root()
  const space = createConfigSpace(ZCODE_DESCRIPTOR, dir)
  const kit = createBootstrap(ZCODE_DESCRIPTOR, space, dir)
  const chunks: string[] = []
  const hostMessage = createHostMessage(ZCODE_DESCRIPTOR)
  const cliMain = createCliMain({
    programName: 'node dist/cli.js',
    message: (lang, key, params = {}) => hostMessage(lang, key as Parameters<typeof hostMessage>[1], params),
    writeOut: (text) => chunks.push(text),
    capabilities: { ask: true, setKeyWizard: true, analyzeMarksState: true, optimizeAutoNotice: true },
    root: { mode: 'pinned', root: space.autoGuardDir },
    optimizeRuntime: () => kit.bootstrap(),
    makeReviewer: () => ({
      async review() {
        return { decision: 'allow', risk: 'low', reason: 'fake' }
      },
      ping: opts.ping ?? (async () => ({ ok: true })),
    }),
  })
  const run = async (argv: readonly string[]) => {
    chunks.length = 0
    const code = await cliMain(argv)
    return { code, out: chunks.join('') }
  }
  await fn(run, dir)
}

/** Unified-CLI-side capture: runCli with the standard fake collaborators. */
function cliDeps(dir: string): CliDeps {
  return {
    makeReviewer: () => ({
      async review() {
        return { decision: 'allow', risk: 'low', reason: 'fake' }
      },
      async ping() {
        return { ok: true }
      },
    }),
    makeAudit: () => fakeAudit(),
    detectRoot: () => dir,
  }
}

describe('runtime CLI snapshot (createCliMain, zcode config space)', () => {
  const entry = (argv: readonly string[], code: number, contains: string) => ({ argv, code, contains })

  it.each([
    entry([], 1, '用法：node dist/cli.js <guard|set|examine|optimize> <action>'),
    entry(['bogus'], 1, '用法：node dist/cli.js <guard|set|examine|optimize> <action>'),
    entry(['guard'], 1, '用法：node dist/cli.js guard <on|off|status|recent|stats|report|ping|ask>'),
    entry(['guard', 'bogus'], 1, '用法：node dist/cli.js guard <on|off|status|recent|stats|report|ping|ask>'),
    entry(['guard', 'ask', 'bogus'], 1, '用法：node dist/cli.js guard ask <list | allow <序号> | deny <序号> [--reason <理由>]>'),
    entry(['set'], 1, '用法：node dist/cli.js set <set-key|show-key|clear-key|set-api|lang|history|reload>'),
    entry(['set', 'bogus'], 1, '用法：node dist/cli.js set <set-key|show-key|clear-key|set-api|lang|history|reload>'),
    entry(['examine'], 1, '用法：node dist/cli.js examine <on|off|status|clear-old|clear-all>'),
    entry(['examine', 'bogus'], 1, '用法：node dist/cli.js examine <on|off|status|clear-old|clear-all>'),
    entry(['optimize'], 1, '用法：node dist/cli.js optimize <status|analyze [--full]|list|rollback>'),
    entry(['optimize', 'bogus'], 1, '用法：node dist/cli.js optimize <status|analyze [--full]|list|rollback>'),
    entry(['optimize', 'auto'], 1, '用法：node dist/cli.js set 不支持 auto'),
    entry(['guard', 'recent'], 0, '(暂无裁决历史)'),
    entry(['guard', 'stats'], 0, '审查日志未开启'),
    entry(['guard', 'report'], 0, '审查日志未开启'),
    entry(['set', 'set-api'], 1, '用法：set set-api base'),
    entry(['set', 'set-api', 'base', 'http://x.example/v1'], 0, '已更新审查端点 base=http://x.example/v1'),
    entry(['examine', 'clear-old'], 0, '已删除 0 条 30 天前记录'),
    entry(['examine', 'clear-all'], 0, '已清空全部审查日志'),
    entry(['guard', 'ask', 'allow', 'x'], 1, '无效序号：x'),
    entry(['guard', 'ask', 'deny', '1'], 2, '序号 1 已不存在'),
  ])('%j → exit $code with $contains', async ({ argv, code, contains }) => {
    await withRuntimeCli(async (run) => {
      const result = await run(argv)
      expect(result.code).toBe(code)
      expect(result.out).toContain(contains)
    })
  })

  it('guard report with examine on renders the window over an empty audit (exit 0)', async () => {
    await withRuntimeCli(async (run, dir) => {
      seedRoot(join(dir, ...ZCODE_DESCRIPTOR.configRootSegments), { examineEnabled: true })
      const result = await run(['guard', 'report'])
      expect(result.code).toBe(0)
      expect(result.out).toContain('近 7 天无审查记录（审计库共 0 条）')
    })
  })

  it('guard on/off flip the persisted flag and echo the receipt', async () => {
    await withRuntimeCli(async (run, dir) => {
      const on = await run(['guard', 'on'])
      expect(on.code).toBe(0)
      expect(on.out).toContain('守卫已启用')
      expect(JSON.parse(readFileSync(join(dir, ...ZCODE_DESCRIPTOR.configRootSegments, 'config.json'), 'utf8') as string).enabled).toBe(true)
      const off = await run(['guard', 'off'])
      expect(off.code).toBe(0)
      expect(off.out).toContain('守卫已停用')
    })
  })

  it('guard ask list starts empty with its dedicated receipt', async () => {
    await withRuntimeCli(async (run) => {
      const result = await run(['guard', 'ask', 'list'])
      expect(result.code).toBe(0)
      expect(result.out).toContain('没有待裁决的 ask')
    })
  })

  it('guard status renders the single-root status with the config path label', async () => {
    await withRuntimeCli(async (run, dir) => {
      seedRoot(join(dir, ...ZCODE_DESCRIPTOR.configRootSegments))
      const result = await run(['guard', 'status'])
      expect(result.code).toBe(0)
      expect(result.out).toContain('enabled : true')
      expect(result.out).toContain(`${join(dir, ...ZCODE_DESCRIPTOR.configRootSegments)}/config.json`)
    })
  })

  it('guard ping succeeds through the injectable reviewer (exit 0)', async () => {
    await withRuntimeCli(async (run) => {
      const result = await run(['guard', 'ping'])
      expect(result.code).toBe(0)
      expect(result.out).toContain('API 联通成功')
    })
  })

  it('guard ping failure exits 2 carrying the error channel', async () => {
    await withRuntimeCli(
      async (run) => {
        const result = await run(['guard', 'ping'])
        expect(result.code).toBe(2)
        expect(result.out).toContain('API 联通失败：boom')
      },
      { ping: async () => ({ ok: false, error: 'boom' }) },
    )
  })

  it('set set-key refuses without a TTY (exit 2, IDE-terminal hint)', async () => {
    await withRuntimeCli(async (run) => {
      const result = await run(['set', 'set-key'])
      expect(result.code).toBe(2)
      expect(result.out).toContain('set set-key 需要交互式终端')
    })
  })

  it('set show-key reports env/store/legacy lines; clear-key clears', async () => {
    await withRuntimeCli(async (run) => {
      const show = await run(['set', 'show-key'])
      expect(show.code).toBe(0)
      expect(show.out).toContain('env DEEPSEEK_API_KEY')
      expect(show.out).toContain('stored')
      expect(show.out).toContain('legacy')
      const clear = await run(['set', 'clear-key'])
      expect(clear.code).toBe(0)
      expect(clear.out).toContain('已清除本地存储的 API Key')
    })
  })

  it('set lang switches and receipts in the new language; unknown values exit 1', async () => {
    await withRuntimeCli(async (run) => {
      const en = await run(['set', 'lang', 'en'])
      expect(en.code).toBe(0)
      expect(en.out).toContain('Language set: en')
      const bad = await run(['set', 'lang', 'fr'])
      expect(bad.code).toBe(1)
      expect(bad.out).toContain('Invalid language value: fr')
    })
  })

  it('set history without a value exits 1; reload prints the note', async () => {
    await withRuntimeCli(async (run) => {
      const history = await run(['set', 'history'])
      expect(history.code).toBe(1)
      const reload = await run(['set', 'reload'])
      expect(reload.code).toBe(0)
      expect(reload.out).toContain('配置与规则在每次 hook 进程启动时自动重读')
    })
  })

  it('examine on/off/status flip the persisted switch', async () => {
    await withRuntimeCli(async (run, dir) => {
      const on = await run(['examine', 'on'])
      expect(on.code).toBe(0)
      expect(on.out).toContain('审查日志已开启')
      const status = await run(['examine', 'status'])
      expect(status.code).toBe(0)
      expect(status.out).toContain('examineEnabled: true')
      const off = await run(['examine', 'off'])
      expect(off.code).toBe(0)
      expect(JSON.parse(readFileSync(join(dir, ...ZCODE_DESCRIPTOR.configRootSegments, 'config.json'), 'utf8') as string).examineEnabled).toBe(false)
    })
  })

  it('optimize status/list/rollback round the learned-rule store', async () => {
    await withRuntimeCli(async (run) => {
      const status = await run(['optimize', 'status'])
      expect(status.code).toBe(0)
      const list = await run(['optimize', 'list'])
      expect(list.code).toBe(0)
      expect(list.out).toContain('无学习规则')
      const rollback = await run(['optimize', 'rollback'])
      expect(rollback.code).toBe(2)
    })
  })

  it('optimize analyze with examine on completes through the kit runtime (exit 0)', async () => {
    await withRuntimeCli(async (run, dir) => {
      seedRoot(join(dir, ...ZCODE_DESCRIPTOR.configRootSegments), { examineEnabled: true })
      const result = await run(['optimize', 'analyze'])
      expect(result.code).toBe(0)
      expect(result.out).toContain('学习规则全量分析完成')
    })
  })
})

describe('unified CLI snapshot (runCli, --config-root)', () => {
  const entry = (argv: readonly string[], code: number, contains: string) => ({ argv, code, contains })

  it.each([
    entry(['guard'], 1, '用法：auto-guard guard <on|off|status|recent|stats|report|ping>'),
    entry(['guard', 'bogus'], 1, '用法：auto-guard guard <on|off|status|recent|stats|report|ping>'),
    entry(['set'], 1, '用法：auto-guard set <set-key|show-key|clear-key|set-api|lang|history|reload>'),
    entry(['examine'], 1, '用法：auto-guard examine <on|off|status|clear-old|clear-all>'),
    entry(['optimize'], 1, '用法：auto-guard optimize <status|analyze [--full]|list|rollback>'),
    entry(['bogus'], 1, '用法：auto-guard <init|list|remove|guard|set|examine|optimize>'),
    entry(['guard', 'ask', 'list'], 1, '用法：auto-guard guard <on|off|status|recent|stats|report|ping>'),
    entry(['guard', 'recent'], 0, '(暂无裁决历史)'),
    entry(['guard', 'stats'], 0, '审查日志未开启'),
    entry(['guard', 'report'], 0, '审查日志未开启'),
    entry(['set', 'set-api'], 1, '用法：set set-api base'),
    entry(['set', 'set-api', 'base', 'http://x.example/v1'], 0, '已更新审查端点 base=http://x.example/v1'),
    entry(['examine', 'clear-old'], 0, '已删除 0 条 30 天前记录'),
    entry(['examine', 'clear-all'], 0, '已清空全部审查日志'),
  ])('%j → exit $code with $contains', async ({ argv, code, contains }) => {
    const dir = root()
    const result = await runCli(['--config-root', dir, ...argv], cliDeps(dir))
    expect(result.code).toBe(code)
    expect(result.output.join('\n')).toContain(contains)
  })

  it('refuses without a resolvable root (exit 2)', async () => {
    const dir = root()
    const result = await runCli(['guard', 'status'], { ...cliDeps(dir), detectRoot: () => undefined })
    expect(result.code).toBe(2)
    expect(result.output[0]).toContain('--config-root')
  })

  it('guard ping reports success through the injectable reviewer (exit 0)', async () => {
    const dir = root()
    const result = await runCli(['--config-root', dir, 'guard', 'ping'], cliDeps(dir))
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('API 联通成功')
  })

  it('guard ping failure exits 2 carrying the error text (injectable reviewer)', async () => {
    const dir = root()
    const result = await runCli(['--config-root', dir, 'guard', 'ping'], {
      ...cliDeps(dir),
      makeReviewer: () => ({
        async review() {
          return { decision: 'allow', risk: 'low', reason: 'fake' }
        },
        async ping() {
          return { ok: false, error: 'boom' }
        },
      }),
    })
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('API 联通失败：boom')
  })

  it('set set-key is the TTY-refusal stub (exit 2) — cli-side product decision', async () => {
    const dir = root()
    const result = await runCli(['--config-root', dir, 'set', 'set-key'], cliDeps(dir))
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('set set-key 需要交互式终端')
  })

  it('aggregate guard status renders only when the root was auto-detected', async () => {
    const dir = root()
    const zcHome = join(dir, '.zcode')
    const zcRoot = join(zcHome, 'auto-guard')
    mkdirSync(zcRoot, { recursive: true })
    writeFileSync(join(zcRoot, 'config.json'), JSON.stringify({ enabled: true, examineEnabled: false }), 'utf8')
    const result = await runCli(['guard', 'status'], {
      ...cliDeps(dir),
      hostRoots: () => [{ label: 'ZCode', homeDir: zcHome, root: zcRoot }],
    })
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('多宿主状态')
    // Explicit root → single-root view, aggregate stays off.
    const explicit = await runCli(['--config-root', zcRoot, 'guard', 'status'], cliDeps(dir))
    expect(explicit.code).toBe(0)
    expect(explicit.output.join('\n')).not.toContain('多宿主状态')
    expect(explicit.output.join('\n')).toContain('enabled : true')
  })

  it('optimize analyze refuses while examine is off (exit 2)', async () => {
    const dir = root()
    const result = await runCli(['--config-root', dir, 'optimize', 'analyze'], cliDeps(dir))
    expect(result.code).toBe(2)
    expect(result.output.join('\n')).toContain('先开启审查日志')
  })

  it('optimize analyze with examine on completes the full analysis (exit 0)', async () => {
    const dir = root()
    seedRoot(dir, { examineEnabled: true })
    const result = await runCli(['--config-root', dir, 'optimize', 'analyze'], cliDeps(dir))
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('学习规则全量分析完成')
  })

  it('guard report with examine on renders the window over an empty audit (exit 0)', async () => {
    const dir = root()
    seedRoot(dir, { examineEnabled: true })
    const result = await runCli(['--config-root', dir, 'guard', 'report'], cliDeps(dir))
    expect(result.code).toBe(0)
    expect(result.output.join('\n')).toContain('近 7 天无审查记录（审计库共 0 条）')
  })
})

describe('cross-entry equivalence (shared actions, same config state)', () => {
  it.each([
    [['guard', 'on'], '守卫已启用'],
    [['examine', 'off'], '审查日志已关闭'],
    [['set', 'reload'], '配置与规则在每次 hook 进程启动时自动重读'],
    [['set', 'lang', 'zh'], '语言已设置：zh'],
  ])('%j exits 0 with the same receipt text on both entries', async (argv, receipt) => {
    const dir = root()
    seedRoot(dir)
    const unified = await runCli(['--config-root', dir, ...argv], cliDeps(dir))
    await withRuntimeCli(async (run, rtDir) => {
      seedRoot(join(rtDir, ...ZCODE_DESCRIPTOR.configRootSegments))
      const runtime = await run(argv)
      expect(runtime.code).toBe(unified.code)
      expect(runtime.code).toBe(0)
      expect(runtime.out).toContain(receipt)
      expect(unified.output.join('\n')).toContain(receipt)
    })
  })

  it('set set-api reset keeps the preserved reset-semantics drift (cli: fresh disk config; runtime: pristine defaults)', async () => {
    const dir = root()
    seedRoot(dir, { apiBase: 'http://custom.example/v1' })
    const unified = await runCli(['--config-root', dir, 'set', 'set-api', 'reset'], cliDeps(dir))
    expect(unified.code).toBe(0)
    expect(unified.output.join('\n')).toContain('http://custom.example/v1')
    await withRuntimeCli(async (run, rtDir) => {
      seedRoot(join(rtDir, ...ZCODE_DESCRIPTOR.configRootSegments), { apiBase: 'http://custom.example/v1' })
      const runtime = await run(['set', 'set-api', 'reset'])
      expect(runtime.code).toBe(0)
      expect(runtime.out).toContain('https://api.deepseek.com')
    })
  })
})
