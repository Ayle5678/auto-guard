# 04 — 文档

What to build:
- `CONTEXT.md`：宿主词条"当前五个"→"当前六个"，补 Qoder（PreToolUse hook 接入、国际版）；不留 CN/CLI 悬空承诺。
- `README.md` / `README.zh-CN.md`：支持宿主列表加 Qoder。
- `docs/usage.md`：qoder 章节——安装（`auto-guard init --host qoder`）、配置根 `~/.qoder/auto-guard/`、验证方式（新会话 + `guard ping`）、无热重载警示（装完必须重启）、两条范围说明：①只支持国际版 IDE，CN 版与 Qoder CLI 不适配；②hooks 写在用户级共享配置，CLI 入口若支持同名事件也会执行（不承诺不验证）。
- `AGENTS.md` / `docs/adr/*`：grep 宿主枚举处一并对齐（AGENTS.md 开头的宿主列举）；确认无需新 ADR（spec 已裁定）。
- 决策历史/统计等用户命令文档（`guard recent`、`guard ping`）如按宿主列举，补 qoder。

Blocked by: 02
Status: done

Acceptance:
- [x] grep 全仓库宿主枚举无遗漏（README 双语、usage.md、cli.md、troubleshooting.md、CONTEXT.md；AGENTS.md 无宿主枚举——只列三前代项目，无需改动）
- [x] README 双语、usage.md、CONTEXT.md 一致提到 qoder 及范围说明
- [x] 文档口径与 spec 范围裁剪一致（国际版 only、CLI 不承诺、delete_file 不守卫——后者按口径只写进 troubleshooting 的覆盖面说明，不算实现细节泄题：它是用户可观察的守卫边界）
