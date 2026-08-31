# 01 — core：持久缓存容量上限 + lastHitAt LRU + 合并不变量 + 配置新键

**What to build:** 持久缓存有 1000 条上限：满员后新写入逐出最久未使用（`lastHitAt ?? cachedAt` 最旧）的条目；命中即刷新 `lastHitAt` 并落盘（hook 宿主每命令新进程，不落盘 LRU 退化为 FIFO）；完全相同命令（同 key）重复写入只覆盖刷新既有条目（cachedAt/expiresAt 续期），绝不堆叠——合并语义以测试钉死。配置面：`sessionCacheSize` 默认 256 → 100；新增 `persistentCacheSize`（默认 1000）进 `GuardConfig` 与 CONFIG_KEYS，存量配置走既有缺失补齐机制自动获得。`SessionLruCache`/`DiskSessionCache` 构造器兜底默认同步对齐 100。

**Blocked by:** None — can start immediately

Status: done

Spec 0016。ADR-0002 纪律：全部在 core 注入缝内，不触碰宿主耦合。

## Scope

- `core/src/types.ts`：`GuardConfig` 增 `persistentCacheSize: number`。
- `core/src/cache.ts`：`CacheEntry` 增可选 `lastHitAt`；`PersistentCache` 构造函数加可选 `maxEntries = 1000`；`get()` 命中刷新 `lastHitAt` 并标脏落盘；`set()` 超限先逐出 `lastHitAt ?? cachedAt` 最旧者；save 照旧过滤过期。`SessionLruCache` 兜底默认 128 → 100。
- `core/src/session-store.ts`：`DiskSessionCache` 兜底默认 256 → 100（`loadSessionState` 实际总是显式传参，此为一致性对齐）。
- `core/src/config.ts`：`sessionCacheSize` 默认 100；新增 `persistentCacheSize: 1000`；CONFIG_KEYS 补键。
- 测试（先例：`cache.spec.ts`、`session-store.spec.ts`）：
  - 容量：写满 1000 + 1 条，最早的（按 lastHitAt/cachedAt）被逐出，size ≤ 1000。
  - LRU：命中中间某条后写新条，被逐出的是未命中的最旧者而非刚命中者。
  - lastHitAt 落盘：新实例从磁盘 hydrate 后命中刷新可存活（模拟进程重启）。
  - 合并：同 key 重复 set 不增 size、续期 expiresAt；`lastHitAt` 缺失的旧条目按 cachedAt 参与逐出（向后兼容）。
  - 配置：默认值断言（新配置 100/1000；存量配置缺 `persistentCacheSize` 时补齐回写）。

## Accept

- [ ] core 全部既有测试不改语义通过（LLM 放行写双缓存等断言不动）。
- [ ] 新增容量/LRU/合并/兼容测试全绿。
- [ ] typecheck 干净。

## Comments

- 2026-08-31：应用户决定，持久缓存容量上限（maxEntries / lastHitAt LRU / persistentCacheSize 配置键）当日移除，持久缓存回到仅 TTL 剪枝；本票的容量与 LRU 部分作废，合并语义、`sessionCacheSize` 默认值部分保留（见 spec Comments）。
