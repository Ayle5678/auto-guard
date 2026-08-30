/**
 * Help screen (SPEC 0011): key bindings + the action ↔ equivalent-CLI
 * mapping as a scrollable document — the full content stays reachable at any
 * viewport via PgUp/PgDn/g/G instead of being cut at the frame bottom.
 */
import { t, type UiKey } from '../i18n.ts'
import type { AppState } from '../types.ts'
import type { Lang } from '@auto-guard/core'
import { clampOffset } from '../ui/kit.ts'
import { seg, theme, type Row } from '../ui/theme.ts'
import { fitToWidth, wrapToWidth } from '../ui/text.ts'

const KEY_BINDINGS: readonly [string, string][] = [
  ['←→ / h l', 'switch screen · 切屏'],
  ['↑↓ / j k', 'move · 移动'],
  ['1…8', 'jump to screen · 跳转屏幕'],
  ['Tab / Shift+Tab', 'installer sub-tabs · 安装子页'],
  ['Enter', 'run / select · 执行 / 选中'],
  ['Space', 'toggle checkbox · 勾选'],
  ['PgUp / PgDn', 'page output/help · 翻页输出/帮助'],
  ['Esc', 'back / cancel · 返回 / 取消'],
  [':', 'command mode · 命令模式'],
  ['r', 'refresh · 刷新'],
  ['g / G', 'scroll top / bottom · 滚动首/尾'],
  ['p', 'ping (dashboard) · 连通性'],
  ['q / Ctrl+C', 'quit (terminal restored) · 退出并恢复终端'],
]

/** Every screen action and its exact CLI equivalent (coverage table). */
const COMMAND_MAP: readonly { screen: UiKey; commands: string[] }[] = [
  { screen: 'tabInstaller', commands: ['init [--host …] [--update-rules|--skip-rules] [--lang]', 'list', 'remove [--host …]'] },
  { screen: 'tabGuard', commands: ['guard on|off', 'guard status', 'guard recent [n]', 'guard stats', 'guard report [days]', 'guard ping'] },
  { screen: 'tabExamine', commands: ['examine on|off', 'examine status', 'examine clear-old', 'examine clear-all'] },
  { screen: 'tabOptimize', commands: ['optimize status', 'optimize analyze', 'optimize list', 'optimize rollback'] },
  { screen: 'tabSet', commands: ['set set-key (wizard)', 'set show-key', 'set clear-key', 'set set-api base|model|reset', 'set lang zh|en', 'set history on|off', 'set reload'] },
]

/** The full help document at current width (scrolling slices it, never cuts). */
export function helpRows(state: AppState): Row[] {
  const L: Lang = state.lang
  const rows: Row[] = []
  // Everything budgets against the FULL frame width and folds (SPEC 0011) —
  // half-width budgets truncated bilingual labels and long command signatures.
  const pushPanel = (title: string, entries: readonly [string, string][], width: number) => {
    rows.push([seg(` ${title}`, theme.title)])
    for (const [key, description] of entries) {
      const parts = wrapToWidth(description, Math.max(8, width - 22))
      parts.forEach((part, i) => {
        rows.push(
          i === 0
            ? [seg(`  ${fitToWidth(key, 16)}`, theme.accent), seg(` ${part}`, theme.muted)]
            : [seg(' '.repeat(19)), seg(` ${part}`, theme.muted)],
        )
      })
    }
  }
  pushPanel(t(L, 'helpKeysTitle'), KEY_BINDINGS, state.width)
  rows.push([{ text: '' }])
  rows.push([seg(` ${t(L, 'helpCmdTitle')}`, theme.title)])
  for (const group of COMMAND_MAP) {
    rows.push([seg(`  ${t(L, group.screen)}`, theme.bold)])
    for (const command of group.commands) {
      const parts = wrapToWidth(command, Math.max(12, state.width - 8))
      parts.forEach((part, i) => rows.push([seg(i === 0 ? `    ${part}` : `      ${part}`, theme.muted)]))
    }
  }
  rows.push([{ text: '' }])
  for (const part of wrapToWidth(`  : <command> — anything the CLI can do · 任何 CLI 命令都可执行`, Math.max(12, state.width - 1))) {
    rows.push([seg(part, theme.ok)])
  }
  return rows
}

/** Total document rows — the reducer's scroll total (render slices/clamps). */
export function helpRowCount(state: AppState): number {
  return helpRows(state).length
}

export function renderHelp(state: AppState): Row[] {
  const rows = helpRows(state)
  const viewport = Math.max(1, state.height - 3)
  const offset = clampOffset(state.views.help?.offset ?? 0, rows.length, viewport)
  return rows.slice(offset, offset + viewport)
}
