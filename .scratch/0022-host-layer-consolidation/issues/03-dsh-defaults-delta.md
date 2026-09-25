# 03 — DSH 配置声明式增量：DSH_DEFAULTS + FieldSpec[] 派生

**What to build:** DSH 配置默认值改为声明式增量：以 core 默认值为基底、逐行覆盖并注释故意原因（空 apiBase = 评审走注入件、更长超时窗、学习阈值、分析间隔等五处）；三份键清单（配置键、用户键、设置页 schema 键）从单一 FieldSpec[] 派生——新增 GuardConfig 字段不再靠手工三处镜像。默认值现值零变化（快照断言逐值钉死）；持久化 schema 零变化。

**Blocked by:** None — can start immediately（独立文件族，可与 01/02 并行）.

**Status:** resolved

- [x] DSH_DEFAULTS 声明式增量；每处覆盖带故意原因注释（apiBase/timeoutMs/learnedCacheableMinTotal/analyzeIntervalMinutes + provider 族扩展字段）
- [x] 三份键清单由 FieldSpec[] 单源派生；派生完整性测试（defaults-delta.spec：清单逐序 pin + schema 默认值同步 + secret 角色）
- [x] 默认值快照断言逐值与今天相同（PINNED_DEFAULTS 全量 toEqual）
- [x] dsh 设置页读写行为不变（config-settings.spec 18/18 绿）；三门禁全绿（typecheck 过）
