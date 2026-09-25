# 04 — 引擎调参切片：GuardTuning 收窄构造接口

**What to build:** 新类型 GuardTuning（引擎调参切片，~10 键纯数据：语言、双 TTL、always-review TTL、超时回调、文件追踪默认、历史开关与双阈值）；GuardService 构造签名从全量配置收窄为切片，切片在单点组合根从全量配置切出；全量配置 schema 与持久化格式零变化。9 个 spec 文件的 45 行 makeConfig 模板收敛为个位数键的 makeTuning；spec setup() 返回其创建的依赖引用（治好伸进私有成员的测试钩子）。

**Blocked by:** 03（构造面等内缝定型后一次收窄，避免两度翻动）.

**Status:** resolved

- [x] GuardTuning 进公共 barrel（types.ts + config.ts tuningOf）；组合根 host-runtime/guard-deps.ts 切出；宿主不直接构造切片
- [x] GuardService 不再触达切片外的配置键（GuardDeps.config: GuardTuning，类型层面收窄）
- [x] 5 个引擎 spec（guard-service/risk/history/ask-escape/template-cache）makeConfig 收敛为 makeTuning（个位数键）；llm/commands 等非引擎 spec 保留各自 makeConfig；既有行为断言不动
- [x] setup()/setupWithPending() 返回 llm 依赖引用；两处 (service as ...).llmReviewer 私有钩子删除
- [x] 新增 GuardConfig 键不再波及引擎接口（guard-tuning.spec 快照钉死切片恰好 10 键）
- [x] 三门禁 + conformance 全绿
