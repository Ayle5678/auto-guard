# 管理 CLI 以 zcode cli.ts 为基底，命令操作层归 core，宿主命令面各取所需

统一 CLI（`packages/cli`）以 zcode 的 cli.ts（最新、最全）为基底：`guard`（on/off/status/recent/stats/ping）、`set`（set-key 向导/show-key/clear-key/set-api/history on|off/reload）、`examine`（on/off/status/clear-old/clear-all）、`optimize`（status/analyze/auto on|off/list/rollback）。实现拆两层：操作函数在 core（被 CLI、pi slash 命令、dsh 设置 UI + Typert remote 共用），终端渲染与 TTY 交互在 CLI。dsh 维持"无 slash 命令、权限预设唯一开关"现状，zcode/pi 的 markdown slash 命令教模型调 CLI 或直接调操作层。

## Consequences

- Windows 纪律沿用：CLI 自然退出（避开 libuv 断言崩溃）、set-key 需真 TTY、退出码 0/2。
- `guard recent`（决策历史 + hitDetail）与加密 set-key 向导（zcode HEAD 最新能力）成为全宿主共有能力。
