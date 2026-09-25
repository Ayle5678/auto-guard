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
    syncApiHeader: '🛡️ 同步评审 API 到所有已装宿主：{base} · {model}',
    syncApiSkipped: '◇ {label} — {root}：auto-guard 未播种，跳过（新开一次宿主会话或 init 后再同步）',
    syncApiRootDone: '✅ {label} — {root}',
    syncApiRootFailed: '⛔ {label} — {root}：写入失败（文件被占用或损坏）',
    syncApiKeyCopied: '🔑 已复制当前根的加密 Key（api-key.json）',
    syncApiKeyCopyFailed: '⚠ 🔑 Key 复制失败（文件被占用）；端点已同步，可稍后重跑 --propagate-key',
    syncApiKeyMissing: '⚠ 当前根（{root}）没有已存的 Key，跳过 Key 传播；端点同步照常（可先 set set-key 再重跑）',
    syncApiNoRoots: '没有可同步的宿主根（宿主未安装，或 auto-guard 均未播种）',
    syncApiDone: '已同步 {count} 个宿主根的评审 API',
  },
  {
    noRootFound: 'No host config root found; pass --config-root <path> (e.g. ~/.zcode/auto-guard)',
    aggregateHeader: '🛡️ auto-guard multi-host status',
    aggregateUnseeded: '◇ {label} — {root}: not seeded yet (created automatically on the next {host} session)',
    aggregateFooter: '(Management commands act on a single host: add --config-root ~/.<host>/auto-guard, or set AUTO_GUARD_CONFIG_ROOT)',
    syncApiHeader: '🛡️ Syncing the review API to every installed host: {base} · {model}',
    syncApiSkipped: '◇ {label} — {root}: auto-guard not seeded, skipped (open a host session or run init first)',
    syncApiRootDone: '✅ {label} — {root}',
    syncApiRootFailed: '⛔ {label} — {root}: write failed (file locked or corrupt)',
    syncApiKeyCopied: '🔑 Stored key copied from the current root (api-key.json)',
    syncApiKeyCopyFailed: '⚠ 🔑 Key copy failed (file locked); endpoint synced, re-run --propagate-key later',
    syncApiKeyMissing: '⚠ Current root ({root}) has no stored key; skipping key propagation, endpoints still synced (run set set-key first and retry)',
    syncApiNoRoots: 'No syncable host roots (no host installed, or auto-guard not seeded anywhere)',
    syncApiDone: 'Review API synced on {count} host root(s)',
  },
)

type ShellChromeKey = Parameters<typeof catalog.message>[1]

/** Shell lookup key: guard-surface keys resolve from the core shared catalog (ADR-0023), the rest from this shell-chrome catalog. */
export type ShellMessageKey = ShellChromeKey | GuardMessageKey

/** Look up one management CLI message. */
export function shellMessage(lang: Lang, key: ShellMessageKey, params: Record<string, string | number> = {}): string {
  return isGuardMessageKey(key) ? guardMessage(lang, key, params) : catalog.message(lang, key, params)
}
