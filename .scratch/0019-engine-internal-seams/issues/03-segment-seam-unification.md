# 03 — 段裁决内缝合一：decideSegment + stats 单点 + 同步守卫前缀共享

**What to build:** 本 spec 的主票。私有 decideSegment 内缝独占「分类 → 记忆 → 缓存 → LLM → 回写」全部实现，decideShell / decidePipeline / decideCompound 退为薄组合策略；缓存回写三连 if（三处逐字拷贝）合一；stats 从 11 处手织递增改为 record(decision) 单点记录（命中从 Decision.source 推导，ruleHits 键集合从 DecisionSource 全集推导）；guardReason 与 decideShell 共享确定性前缀（两者返回值逐字节不变）；删除全仓零调用者的 sessionIdOf。内缝不进公共 barrel——宿主无法绕过 decide()。

**Blocked by:** 02（记忆咨询先就位，段缝才能以它为依赖）.

**Status:** resolved

- [x] decideSegment 私有内缝（SegmentScope 三口径：single / pipeline-leaf / compound-segment）；三个 decide 为薄策略；不进公共 barrel
- [x] writeBackCaches 单一定义点（allow 且非 high + 分类门槛）
- [x] record(decision) 单点记录；ruleHits 键集合 Extract 自 DecisionSource；cache 命中从 fromCache 生产点推导；llmCalls 留 llmDecision；既有 stats 断言原样钉死
- [x] guardReason 返回值逐字节不变（hardDenyReason/hardDeny 共享，仅内部实现）
- [x] sessionIdOf 删除（确认为全仓零调用者）
- [x] 既有三路测试断言不动（git diff 验证：0 条 expect/断言行变更）
- [x] 三门禁 + conformance 全绿
