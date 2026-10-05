# 04 — 文档与观测：删除分级 / 脚本附审的用户面说明 + 降噪验收口径

**What to build:** 用户文档补两块行为说明（usage / troubleshooting 按现有章节归位）：① 目录删除的三级处置（哪些删除不再要理由、哪些必经人工、阈值在 defaults 的 `directoryDeletePolicy` 可调）；② 脚本附审（何时自动附内容复审、为何敏感路径永远不附）。并落观测口径：上线后 14 天对比 decision-history / audit 的 llm-ask 率（目标 2.5% → ≤1.2%，SPEC 0027 验收）与删除流协议往返占比（目标从 ~64% 降一半以上，SPEC 0028 验收），口径写成可重跑的一次性统计（沿用本次调研的 decision-history.jsonl 聚合方法，不新增长驻工具）。

**Blocked by:** 02（分级接线落地后文档才有所指）；软依赖 0027/03（脚本附审说明）。

**Status:** ready-for-agent

- [ ] usage 文档：三级删除处置与 directoryDeletePolicy 阈值调法、脚本附审触发条件与边界（含"敏感路径内容永不送 LLM"重申）
- [ ] troubleshooting：powershell 包裹删除理由已能一次接上（移除/改写相关旧 workaround，如有）
- [ ] 观测口径落盘（统计脚本片段或命令序列进 docs），跑出基线数并记录在本票 Comments
- [ ] CONTEXT.md 术语与实现无漂移（脚本附审/删除分级/根邻近三词条核对）

## Comments

- 基线（2026-10-05 调研，decision-history 30 天窗口）：llm-ask 203 次 / 28,322 决策（2.5%，月度趋势 1.0→1.7→2.5）；删除流 143 次决策 = 80 首击要理由 + 11 理由未接上 + 约 50 复审（35 allow / 13 ask）。
