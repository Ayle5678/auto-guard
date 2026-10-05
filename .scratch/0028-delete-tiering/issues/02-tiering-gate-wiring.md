# 02 — 删除流接线：三级门进 decideDirectoryDelete

**What to build:** 目录删除复核入口（含复合命令首击扫描处的每个删除段）在首击拒绝**之前**调用分级模块，按级分流：**轻量**——免理由协议，整条命令转一次普通评审，放行写会话短 TTL 缓存（复用 always-review TTL 机制），不写持久缓存；**标准**——现行流程原样（理由协议 + 低推理单次复审 + 非 allow 转人工）；**严格**——理由协议照走 + high 推理档复审（接 reviewTimeoutBudget 既有 high ≥30s 分支）+ 复审 allow 不生效、上限收为 ask 转宿主人工确认；**文件目标**（01 模块的独立信号：全部目标 stat 为普通文件且无失败）——不进理由协议，回落普通管线，敏感路径门照常先拦。用户侧效果：`rm -rf __pycache__` 一次评审即过；`rm -rf D:\大目录` 必过人工；`rm -rf 某文件` 不再被要理由。

**Blocked by:** 01（分级数据与判定纯模块）。

**Status:** ready-for-agent

- [ ] 轻量：`rm -rf __pycache__`（真目录 fixture）不出现 needsReason 拒，单次评审放行，会话短 TTL 写回（缓存层断言命中与过期）
- [ ] 标准：guard-service 既有删除流用例全绿零改动（回归底线）
- [ ] 严格：盘根一级目录 fixture → 首击要理由 → 带理由重试 → stub 强制回 allow → 最终 kind=ask（收口断言）+ high 推理档传参断言
- [ ] 文件回落：`rm -rf <file>` 不进理由协议走普通评审；`rm -rf .env` 被敏感路径降级拦在前
- [ ] 复合命令：`cd <ws> && rm -rf tmpdir && ls` 轻量段免协议、其余段照常评审
- [ ] pending 表行为：轻量/文件回落不写 pending 条目；标准/严格首击照写
- [ ] 决策来源标签与 decision-history 详情可辨级别（轻量/标准/严格）

## Comments

- 不变式自检（ADR-0012/0027）：分级不改分类优先序——递归删除仍必进删除流，分级判定在流内；`classifySimple` 与 directoryDelete 枚举零触碰。
