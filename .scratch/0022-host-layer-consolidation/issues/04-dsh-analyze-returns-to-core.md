# 04 — DSH 学习分析/回滚回归 core：full 与口令门选项

**What to build:** core 学习分析选项扩展 full（读全部审计历史）与可选口令门；DSH 私有分析与回滚包装删除，remote「立即分析」改调 core 操作并传 full（保持今天永远全量的行为，从隐蔽行为变成显式参数）、口令门前置。pi/cli/zcode 既有调用零改动。分析产物（合并续写、锚定不变式）与回滚行为不变。

**Blocked by:** None — can start immediately（core 操作扩展独立，可与 01-03 并行）.

**Status:** resolved

- [x] core 分析选项含 full 与口令门（passwordGate + 文案槽 message，语义与既有窗口+合并规则一致；commands.spec 新增两用例）
- [x] DSH 私有分析与回滚包装删除（generate/merge/write 管道全删）；remote 行为不变（永远全量显式化为 full:true，DSH 文案经 message 槽逐字节保留）
- [x] pi/cli 既有分析调用零改动（既有测试不动）
- [x] 三门禁全绿（core 21/21、dsh 39/39、typecheck 过）
