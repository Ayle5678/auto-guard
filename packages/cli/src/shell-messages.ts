/**
 * Management CLI message catalog (zh / en) — the shell's own rendering text
 * (aggregate status, stats/ping, key/endpoint receipts). Usage lines are
 * engine-owned text parameterized by the program name (ADR-0022); the
 * installer keeps its own catalog. Key parity between languages is enforced
 * by the type system (ADR-0011).
 */
import { defineCatalog, guardMessage, isGuardMessageKey, type GuardMessageKey, type Lang } from '@auto-guard/core'

const catalog = defineCatalog(
  {
    noRootFound: '未找到宿主配置根；请用 --config-root <path> 指定（例如 ~/.zcode/auto-guard）',
    aggregateHeader: '🛡️ auto-guard 多宿主状态',
    aggregateUnseeded: '◇ {label} — {root}：尚未播种（新开一次 {host} 会话后自动创建）',
    aggregateFooter: '（管理命令作用于单个宿主：加 --config-root ~/.<host>/auto-guard，或设 AUTO_GUARD_CONFIG_ROOT）',
  },
  {
    noRootFound: 'No host config root found; pass --config-root <path> (e.g. ~/.zcode/auto-guard)',
    aggregateHeader: '🛡️ auto-guard multi-host status',
    aggregateUnseeded: '◇ {label} — {root}: not seeded yet (created automatically on the next {host} session)',
    aggregateFooter: '(Management commands act on a single host: add --config-root ~/.<host>/auto-guard, or set AUTO_GUARD_CONFIG_ROOT)',
  },
)

type ShellChromeKey = Parameters<typeof catalog.message>[1]

/** Shell lookup key: guard-surface keys resolve from the core shared catalog (ADR-0023), the rest from this shell-chrome catalog. */
export type ShellMessageKey = ShellChromeKey | GuardMessageKey

/** Look up one management CLI message. */
export function shellMessage(lang: Lang, key: ShellMessageKey, params: Record<string, string | number> = {}): string {
  return isGuardMessageKey(key) ? guardMessage(lang, key, params) : catalog.message(lang, key, params)
}
