# 10 — packages/cli：统一管理 CLI

What to build:
- 以 zcode cli.ts（最新）为基底的终端壳：`guard`（on/off/status/recent/stats/ping）、`set`（set-key 三步向导/show-key/clear-key/set-api base|model|reset/history on|off/reload）、`examine`（on/off/status/clear-old/clear-all）、`optimize`（status/analyze/auto on|off/list/rollback）。
- 全部子命令改调 core 操作层（issue 06 产物），CLI 只做参数解析、表格渲染、TTY 交互。
- `--config-root <path>` 全局 flag（测试与多环境）；默认根按宿主探测或显式指定。
- Windows 纪律：自然退出、set-key 需真 TTY、退出码 0/2。
- `guard recent` 渲染沿用 zcode 表格式（时间/工具/结果/层级/命中详情）。

Blocked by: 06
Status: ready-for-agent

Acceptance:
- [ ] zcode cli/decision-history 相关 spec 迁入并通过
- [ ] 全部子命令在 fake deps 集成测试中走通，无需真实网络/SQLite
- [ ] PowerShell alias 设置文档（docs/cli.md 前身）更新为统一包路径
