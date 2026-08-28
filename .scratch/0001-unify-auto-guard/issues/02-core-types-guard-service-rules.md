# 02 — core：类型 + 裁决管线 + 规则引擎

What to build:
- `packages/core/src/types.ts`：GuardRequest / Decision / RulesFile / GuardConfig **超集 schema**（zcode 38 键 + dsh 特有键），零宿主依赖。
- `guard-service.ts`：以 zcode 版注入化实现为基底，吸收 dsh 独有逻辑——Remove-Item 运行时目录判定、`[删除理由]` 会话事件扫描、管道叶子确定性放行、staticAllowGuard 降级、pendingDenies（Guard Memory）、GuardStats。
- `command.ts`（引号感知拆分、命令替换/操作符检测）、`rules.ts`（glob 分类、mergeMissingRuleFields 自愈、播种）。
- `defaults/rules.json`：三库并集 + 人工复审去重（staticAllow 114/dsh100/zcode110、alwaysReview 71/80、sensitivePaths 15 等逐类合并）。

Blocked by: 01
Status: ready-for-agent

Acceptance:
- [ ] 前代 guard-service/rules/command 相关 spec 断言全部迁入 core 且绿
- [ ] Decision.source 枚举与 CONTEXT.md 术语表一致
- [ ] 并集规则文件中每条 pattern 三库语义核对无冲突（同 pattern 不同 reason 的取最新 reason 并记录在提交说明）
