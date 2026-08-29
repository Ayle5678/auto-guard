/**
 * init 启动头图：实心块状大字（AUTO GUARD）+ ANSI Shadow 式双线立体钩边，逐行渐变。
 *
 * 字形用 7 行像素网格定义（# = 一块实心 ██，. = 空白）。立体钩边与 ANSI
 * Shadow 字体同构，由确定性规则从字形生成：右缘暴露 → 同行右侧长出 ║（起
 * 点 ╗）；下缘暴露 → 下一行长出 ══（起点 ╚、接笔画处 ╔）；竖线止于笔画终点
 * → ╝ 收口；实心块覆盖一切交叠。每个字母 (H+1)×(W+1) 定宽画布，逐行拼接
 * 天然对齐。颜色自上而下逐行渐变（亮青 → 蓝 → 紫），钩边与所在行同色。
 * 纯装饰：只在交互终端（stdout TTY）打印，NO_COLOR 时退化为无色版本，管道
 * / CI / 测试下完全不输出，安装器的结构化输出保持可解析。
 */
import { createRequire } from 'node:module'
import { message } from './i18n.ts'
import { HOST_IDS } from './profiles.ts'

/** 逐行渐变（256 色），自上而下：亮青 → 蓝 → 紫。 */
const GRADIENT = ['51', '45', '39', '33', '27', '21', '93'] as const

/** 7 行像素网格字母（每行一个字符串，# 实心 / . 空白）。 */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.##.', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
  D: ['###.', '#..#', '#..#', '#..#', '#..#', '#..#', '###.'],
  G: ['.###', '#...', '#...', '#.##', '#..#', '#..#', '.##.'],
  O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  R: ['###.', '#..#', '###.', '#..#', '#..#', '#..#', '#..#'],
  T: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '.#.'],
  U: ['#..#', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
}

const GLYPH_H = 7
const WORD_GAP = '    '
const LETTER_GAP = '  '
const WORDS: readonly (readonly string[])[] = [
  ['A', 'U', 'T', 'O'],
  ['G', 'U', 'A', 'R', 'D'],
]

const glyphOf = (ch: string): readonly string[] =>
  GLYPHS[ch] ?? Array.from({ length: GLYPH_H }, () => '....')

type Cell = { kind: 'solid' } | { kind: 'line'; chars: string } | undefined

/** 从像素字形生成立体钩边画布：(H+1)×(W+1)，先竖后横再收口，实心最后覆盖一切交叠。 */
function buildLetter(ch: string): Cell[][] {
  const glyph = glyphOf(ch)
  const W = glyph[0]!.length
  const solid = (r: number, c: number): boolean => r >= 0 && r < GLYPH_H && c >= 0 && c < W && glyph[r]![c] === '#'
  const grid: Cell[][] = Array.from({ length: GLYPH_H + 1 }, () => Array.from({ length: W + 1 }, () => undefined))
  // 竖钩边：右缘暴露 → 同行右侧 ║，起点（上方无实心）用 ╗ 收顶；末行的悬空起点无意义，跳过。
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < W; c++) {
      if (solid(r, c) && !solid(r, c + 1)) {
        const topCap = !solid(r - 1, c)
        if (!(topCap && r === GLYPH_H - 1)) grid[r]![c + 1] = { kind: 'line', chars: topCap ? '╗ ' : '║ ' }
      }
    }
  }
  // 横钩边：下缘暴露 → 下一行 ══；接左侧笔画用 ╔，接上一格钩边用 ══，否则 ╚ 起头。盖掉同行竖钩边。
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < W; c++) {
      if (solid(r, c) && !solid(r + 1, c)) {
        const afterUnderside = grid[r + 1]![c - 1]?.kind === 'line'
        const afterSolid = solid(r + 1, c - 1)
        grid[r + 1]![c] = { kind: 'line', chars: afterUnderside ? '══' : afterSolid ? '╔═' : '╚═' }
      }
    }
  }
  // 竖钩边止于笔画终点 → 下一行 ╝ 收口（右侧本就无实心，不会与横钩边同格）。
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < W; c++) {
      if (!solid(r, c) || solid(r, c + 1) || solid(r + 1, c)) continue
      const below = grid[r + 1]![c + 1]
      if (below?.kind !== 'solid') grid[r + 1]![c + 1] = { kind: 'line', chars: '╝ ' }
    }
  }
  // 实心最后落笔，覆盖一切交叠。
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < W; c++) {
      if (solid(r, c)) grid[r]![c] = { kind: 'solid' }
    }
  }
  return grid
}

/** 一行文本：实心块与钩边都着该行渐变色。不截尾——字母画布定宽，拼接后天然对齐。 */
function renderGridRow(grid: Cell[][], row: number, noColor: boolean): string {
  const rowColor = GRADIENT[Math.min(row, GRADIENT.length - 1)]
  let out = ''
  for (const cell of grid[row]!) {
    if (cell === undefined) {
      out += '  '
      continue
    }
    const text = cell.kind === 'solid' ? '██' : cell.chars
    out += noColor ? text : `\u001b[38;5;${rowColor}m${text}\u001b[0m`
  }
  return out
}

const LETTER_GRIDS: Record<string, Cell[][]> = Object.fromEntries([...new Set(WORDS.flat())].map((ch) => [ch, buildLetter(ch)]))

/** CLI 包版本号（workspace 与 npm 安装两种布局都指向 cli 自己的 package.json）。 */
function cliVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    return (require('../../package.json') as { version?: string }).version ?? '?'
  } catch {
    return '?'
  }
}

/** 宿主清单行：从 HOST_IDS 派生，新增宿主自动跟上（不再手写、不会过时）。 */
const hostList = (): string => `（适配 ${HOST_IDS.join(' / ')}）`

/**
 * 纯函数：返回带头图的行数组（含 ANSI 码；noColor 时不加色）。tagline 固定四行：
 * 包名版本 / 中文名 / 英文名 / 宿主清单 —— 名字两行天然双语，不随语言切换。
 */
export function renderBanner(noColor = false): string[] {
  const rows: string[] = ['']
  for (let r = 0; r < GLYPH_H + 1; r++) {
    rows.push(WORDS.map((word) => word.map((ch) => renderGridRow(LETTER_GRIDS[ch]!, r, noColor)).join(LETTER_GAP)).join(WORD_GAP).replace(/\s+$/, ''))
  }
  const taglineLines = [`auto-guard v${cliVersion()}`, message('zh', 'bannerGuardName'), message('en', 'bannerGuardName'), hostList()]
  for (const line of taglineLines) {
    rows.push(noColor ? `  ${line}` : `  \u001b[2m${line}\u001b[0m`)
  }
  rows.push('')
  return rows
}

export interface BannerOptions {
  /** 强制开/关；缺省时跟随 stdout 是否为 TTY。 */
  enabled?: boolean
  /** NO_COLOR 场景退化显示（测试注入；缺省读环境变量）。 */
  noColor?: boolean
  /** 输出目标（测试注入；缺省 process.stdout）。 */
  write?: (text: string) => void
}

/** 在 init 真正动手前直接写 stdout —— CLI 的结构化输出是跑完后一次性打印的，头图必须即时上屏。 */
export function showBanner(options: BannerOptions = {}): void {
  const enabled = options.enabled ?? process.stdout.isTTY === true
  if (!enabled) return
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR)
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  write(`${renderBanner(noColor).join('\n')}\n`)
}
