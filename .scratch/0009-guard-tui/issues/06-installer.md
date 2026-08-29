# 0009 — Issue 06：安装屏——检测多选 / 规则更新选择 / 计划预览 / apply / remove

What to build:
- 安装屏（屏 6）三个子页（Tab 或分区切换）：
  - **Init**：`detectHosts` 结果多选列表（检测证据随行显示，未检测宿主可手动勾选——沿用 installer 的 manual-confirm 语义改为确认框）；语言选择（若机器无默认且 env 未设，先双语选择，写入机器默认——ADR-0011 语义）；规则文件更新选择（update / skip，ADR-0013，默认预览后决定）；计划预览（`buildInitPlan` 步骤 + `buildRuleUpdatePlan` 摘要，diff 语义渲染）；确认（红框）后执行 `runInstallerCommand(['init','--host',ids.join(','),'--yes', rulesFlag, '--lang', lang])`——`--yes` 跳过的是 CLI 自己的行确认，TUI 已用等价预览+确认替代；输出原样进日志。
  - **Status**：`list` 输出渲染（检测证据 + 集成状态 + 下一步），复用 `integrationStatus`。
  - **Remove**：宿主多选（仅已集成项可选）→ 红色确认 → `remove --host …`。
- 安装屏不受 config-root 影响（安装器在根解析之前运行）；头部显示「installer 模式」提示。
- 已集成宿主在 Init 列表中标 `已集成` 且默认不选（对应 `alreadyIntegrated` 跳过语义）。

Blocked by: 03
Status: ready-for-agent

Acceptance:
- [ ] 全流程（多选 → 规则选择 → 预览 → 确认 → 执行 → 日志回执）TUI 内闭环，与 `init --host … --yes …` 等价（注入假 InstallerDeps 断言 argv）
- [ ] 预览渲染包含备份步骤与规则更新预览条目
- [ ] remove 仅对已集成宿主生效且必须过确认；数据根保留的提示可见
- [ ] 语言选择写入机器默认，下次进入不再询问
- [ ] 单测：子页状态机 + argv 组装 + 假 deps 执行断言
