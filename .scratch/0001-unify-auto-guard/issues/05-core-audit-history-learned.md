# 05 — core：审计双实现 + 历史层 + 学习规则

What to build:
- `AuditStore` 接口 + 双实现（ADR-0005）：`SqlcipherAuditStore`（dsh 0.2.0 的 audit.ts + audit-crypto SQLCipher 部分：pragma、WAL、rekey、exportPlaintext、createNew/orphan 语义、旧库自动迁移备份）与 `LightAuditStore`（zcode 的 node:sqlite + 字段级 AES-GCM）。共享 18 列 schema、`redactCommand` 脱敏、clearOld/clearAll。SQLCipher 不可用时自动降级 Light 并在 status 标注加密级别。
- `skeleton.ts`（类型化占位符骨架）、`history.ts`（阈值判定、60s 刷新）、`learned-rules.ts`（**cacheable-only** + NON_LEARNABLE_CACHEABLE 黑名单 + 加载期过滤去重 + 备份回滚）、`template-cache.ts`（磁盘版，参数变体命中）。

Blocked by: 03, 04
Status: done

Acceptance:
- [x] 两审计实现通过同一接口契约测试（含迁移用例：旧明文库、旧字段加密库 → SQLCipher）
- [x] dsh audit-sqlcipher spec 与 zcode audit spec 分别在对应实现上通过
- [x] 学习规则生成结果与 dsh 0.2.0 加固后行为一致（不产 staticAllow、脏条目被加载期过滤）

## Comments

- 2026-08-28: done — AuditStore interface + LightAuditStore (node:sqlite field AES-GCM) + SqlcipherAuditStore (optional dep, legacy migration/rekey/export); contract spec + dsh sqlcipher spec ported; learned-rules absorbed dsh dedupeByPattern
