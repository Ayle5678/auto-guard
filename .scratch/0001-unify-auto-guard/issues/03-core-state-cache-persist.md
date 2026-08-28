# 03 — core：会话态双实现 + 缓存

What to build:
- 会话态组件接口（session cache、tracker store、pending sinks）进 core（ADR-0004）。
- 内存实现：现 SessionLruCache（256、TTL、会话清空）。
- 磁盘实现：zcode 的 `session-store.ts` + `persist-map.ts` 提升 core（DiskSessionCache 写透 + TTL 剪枝、PersistableMap、>24h 会话目录剪枝）。
- `cache.ts`：PersistentCache（workspace 隔离、low 30d / medium 7d / high 永不、deny 不入）+ `ttlForRisk`。
- `file-tracker.ts`（WriteStore 注入）、`sensitive-path.ts`。

Blocked by: 02
Status: ready-for-agent

Acceptance:
- [ ] 内存与磁盘实现通过同一套接口契约测试
- [ ] zcode session-store/persist-map spec 原样迁入并通过
- [ ] 宿主 bootstrap 只需换一个工厂函数即可切换实现
