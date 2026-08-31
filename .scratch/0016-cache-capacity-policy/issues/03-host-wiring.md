# 03 — 宿主接线：persistentCacheSize 传参 + DSH 默认拷贝同步

**What to build:** 三类宿主的持久缓存组装点全部传入 `config.persistentCacheSize`，使 1000 条上限对所有宿主生效；DSH 自有的配置默认值拷贝同步（`sessionCacheSize` 256 → 100、新增 `persistentCacheSize` 1000 进字段表），DSH 用户升级后自动补齐新键。

**Blocked by:** 01 — core-cache-capacity（`persistentCacheSize` 配置字段与 `PersistentCache` 构造参数须先存在）

Status: done

Spec 0016。ADR-0003：配置根每宿主隔离不动，只是容量参数接线。

## Scope

- `host-runtime/src/bootstrap.ts`：持久缓存构造传 `config.persistentCacheSize`。
- `host-dsh/src/config.ts`：默认对象 `sessionCacheSize` 100、增 `persistentCacheSize: 1000`；字段表补 `persistentCacheSize` 条目（field 表与 key 列表两处）。
- `host-dsh/src/index.ts`：持久缓存构造传 `config.persistentCacheSize`（路径 expandHome 语义不变）。
- `host-pi/src/index.ts`：持久缓存构造传 `config.persistentCacheSize`。
- `packages/conformance` 构造点：持久缓存构造传 `config.persistentCacheSize`。
- 测试：host-runtime `guard-deps.spec.ts` 既有构造断言确认传参后不回归；DSH config 测试补默认值与新键断言（若其 config 测试结构允许）。

## Accept

- [ ] 三组装点 + conformance 全部显式传 `persistentCacheSize`。
- [ ] DSH 新配置含 100/1000，存量配置补齐新键。
- [ ] 受影响包测试与 typecheck 全绿。
