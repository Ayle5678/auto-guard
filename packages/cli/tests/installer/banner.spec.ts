import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderBanner, renderBannerGrid, showBanner } from '../../src/installer/banner.ts'
import { runCli } from '../../src/shell.ts'
import type { InstallerDeps } from '../../src/installer/install.ts'

const dirs: string[] = []
function fakeHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-banner-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('renderBannerGrid (SPEC 0010)', () => {
  it('exposes the plain 7+1-row wordmark without ANSI or taglines', () => {
    const grid = renderBannerGrid()
    expect(grid).toHaveLength(8)
    const text = grid.join('\n')
    expect(text).not.toContain('\u001b[')
    expect(text).toContain('████╗')
    expect(text).not.toContain('auto-guard v') // taglines stay in renderBanner
    // Same glyph asset the installer banner renders.
    expect(grid).toEqual(renderBanner(true).slice(1, 9))
  })
})

describe('init banner', () => {
  it('renders seven solid block-letter rows with double-line extrusion and a version tagline', () => {
    const plain = renderBanner(true)
    const content = plain.filter((r) => r.trim() !== '')
    expect(content.length).toBe(12) // 7 letter rows + 1 extrusion row + 4 tagline lines
    expect(plain[1]).toContain('████╗')
    expect(plain[4]).toContain('████████║') // A crossbar with right edge
    expect(plain[8]).toContain('╚═╝') // closed stroke feet
    expect(plain.join('\n')).toContain('══') // double-line extrusion: horizontal
    expect(plain.join('\n')).toContain('║') // double-line extrusion: vertical
    expect(plain.join('\n')).toContain('╔═') // resume-after-stroke corner
    expect(plain.join('\n')).toContain('╚═') // run-start corner
    expect(plain.join('\n')).toContain('╗') // vertical top cap
    expect(plain.join('\n')).toContain('╝') // vertical end cap
    expect(plain.join('\n')).not.toContain('░░') // no blocky shadow layer
    expect(plain.join('\n')).not.toContain('─') // single lines are gone
    // GUARD starts at the same column on every row (regression: word rows
    // must not be trailing-trimmed before the join, or GUARD drifts per row).
    const guardCol = plain.slice(1, 9).map((r) => r.slice(48, 50))
    // G col0: empty top row, solid stroke rows, underside foot `╚═`, empty extrusion row.
    expect(guardCol).toEqual(['  ', '██', '██', '██', '██', '██', '╚═', '  '])
    expect(plain.join('\n')).toContain('缓存式自动命令审查')
    expect(plain.join('\n')).toContain('Cached Auto Command Review')
    expect(plain.join('\n')).toContain('（适配 dsh / pi / zcode / claude / opencode / qoder / codex）')
    expect(plain.join('\n')).toContain('auto-guard v')
  })

  it('colors one gradient hue per row (cyan to violet), lines included', () => {
    const colored = renderBanner(false)
    expect(colored[1]).toContain('\u001b[38;5;51m') // top row: bright cyan
    expect(colored[7]).toContain('\u001b[38;5;93m') // bottom letter row: violet
    expect(colored[8]).toContain('\u001b[38;5;93m') // extrusion row shares the last hue
    const all = colored.join('\n')
    expect(all).not.toContain('\u001b[38;5;196m') // no rainbow red
    expect(all).not.toContain('\u001b[38;5;240m') // no grey shadow pass
    expect(all).toContain('缓存式自动命令审查')
  })

  it('noColor variant strips every ANSI escape', () => {
    const text = renderBanner(true).join('\n')
    expect(text).not.toContain('\u001b[')
    expect(text).toContain('██')
    expect(text).toContain('auto-guard v')
  })

  it('tagline is fixed bilingual: zh and en name lines plus the seven-host list', () => {
    const text = renderBanner(true).join('\n')
    expect(text).toContain('缓存式自动命令审查')
    expect(text).toContain('Cached Auto Command Review')
    expect(text).toContain('（适配 dsh / pi / zcode / claude / opencode / qoder / codex）')
  })

  it('interactive init shows the banner before the language prompt; unpinned tagline is bilingual', async () => {
    const home = fakeHome()
    const events: string[] = []
    const deps: InstallerDeps = {
      home,
      stdinIsTTY: true,
      banner: true,
      writeOut: (t) => events.push(t),
      readLine: async (prompt) => {
        events.push(prompt)
        return '2'
      },
    }
    const result = await runCli(['init'], { installer: deps })
    expect(result.code).toBe(2) // nothing detected under the fake home
    expect(events[0]).toContain('██')
    expect(events[0]).toContain('缓存式自动命令审查')
    expect(events[0]).toContain('Cached Auto Command Review')
    expect(events[1]).toContain('Select language')
  })

  it('showBanner gates on enabled and honours the injected sink', () => {
    let captured = ''
    showBanner({ enabled: false, write: (t) => (captured += t) })
    expect(captured).toBe('')
    showBanner({ enabled: true, noColor: true, write: (t) => (captured += t) })
    expect(captured).toContain('auto-guard v')
  })

  it('init routes the banner to the injected sink, never into the output array', async () => {
    const home = fakeHome()
    let captured = ''
    const deps: InstallerDeps = { home, stdinIsTTY: false, banner: true, writeOut: (t) => (captured += t) }
    const result = await runCli(['init'], { installer: deps })
    expect(result.code).toBe(2)
    expect(captured).toContain('██')
    expect(result.output.join('\n')).not.toContain('██')
  })

  it('--banner forces the banner on without a TTY; default stays off', async () => {
    const home = fakeHome()
    let captured = ''
    const base: InstallerDeps = { home, stdinIsTTY: false, writeOut: (t) => (captured += t) }
    const without = await runCli(['init'], { installer: { ...base } })
    expect(without.code).toBe(2)
    expect(captured).toBe('')
    const forced = await runCli(['init', '--banner'], { installer: { ...base } })
    expect(forced.code).toBe(2)
    expect(captured).toContain('██')
  })
})
