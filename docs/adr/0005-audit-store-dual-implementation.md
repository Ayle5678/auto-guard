# 审计库双实现：SQLCipher 全库加密为主，node:sqlite 轻量版兜底

dsh 0.2.0 刚把审计迁移到 SQLCipher 全库加密（better-sqlite3-multiple-ciphers）；zcode 插件受零 native 依赖约束，用 node:sqlite + 字段级 AES-GCM。两个"最新"冲突，取舍为 **AuditStore 接口 + 双实现**：`SqlcipherAuditStore`（dsh/pi 使用，optionalDependency，缺失时自动降级）与 `LightAuditStore`（zcode 使用）。两实现共享表 schema（18 列）、脱敏（redactCommand）、旧库迁移与维护操作（rekey/导出明文/清理/orphan 语义）；历史层与学习规则只依赖接口。

## Considered Options

- 全统一 SQLCipher：zcode 被迫带 native 依赖，破坏其"克隆即用"的安装简单性。
- 全统一 node:sqlite 字段加密：推翻 dsh 0.2.0 刚完成的加密升级，放弃全库加密强度。

## Consequences

- `better-sqlite3-multiple-ciphers` 作为 core 的 optionalDependency；SQLCipher 不可用时 dsh/pi 降级到 LightAuditStore 并在 status 中标注加密级别。
- 审计完全 best-effort：任何审计失败不得阻塞裁决（三前代一致的既有纪律）。
