/**
 * Help screen: key bindings + the action ↔ equivalent-CLI mapping — the
 * self-evidencing coverage checklist (SPEC 0009 ticket 07).
 */
import { t, type UiKey } from '../i18n.ts'
import type { AppState } from '../types.ts'
import type { Lang } from '@auto-guard/core'
import { splitWidth } from '../ui/kit.ts'
import { seg, theme, type Row } from '../ui/theme.ts'
import { fitToWidth } from '../ui/text.ts'

const KEY_BINDINGS: readonly [string, string][] = [
  ['←→ / h l', 'switch screen · 切屏'],
  ['↑↓ / j k', 'move · 移动'],
  ['1…8', 'jump to screen · 跳转屏幕'],
  ['Tab / Shift+Tab', 'installer sub-tabs · 安装子页'],
  ['Enter', 'run / select · 执行 / 选中'],
  ['Space', 'toggle checkbox · 勾选'],
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

export function renderHelp(state: AppState): Row[] {
  const L: Lang = state.lang
  const { left, right } = splitWidth(state.width, 0.38)
  const rows: Row[] = []
  // The keys table renders as its own full-width block — budget descriptions
  // against the whole frame, or bilingual labels truncate at half width.
  const pushPanel = (title: string, entries: readonly [string, string][], width: number) => {
    rows.push([seg(` ${title}`, theme.title)])
    for (const [key, description] of entries) {
      rows.push([seg(`  ${fitToWidth(key, 16)}`, theme.accent), seg(` ${fitToWidth(description, width - 22)}`, theme.muted)])
    }
  }
  pushPanel(t(L, 'helpKeysTitle'), KEY_BINDINGS, state.width)
  rows.push([{ text: '' }])
  rows.push([seg(` ${t(L, 'helpCmdTitle')}`, theme.title)])
  for (const group of COMMAND_MAP) {
    rows.push([seg(`  ${t(L, group.screen)}`, theme.bold)])
    for (const command of group.commands) rows.push([seg(`    ${fitToWidth(command, right - 6)}`, theme.muted)])
  }
  rows.push([{ text: '' }])
  rows.push([seg(`  : <command> — anything the CLI can do · 任何 CLI 命令都可执行`, theme.ok)])
  return rows
}
