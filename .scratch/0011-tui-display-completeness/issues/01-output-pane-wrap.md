# 01 — 输出面板渲染期折行：只折行不静默截断

**What to build:** TUI 的全部命令输出表面——四个列表屏的输出面板、安装屏预览面板、日志屏——对超宽行在渲染路径折行（复用既有 CJK 感知 `wrapToWidth`），不再静默截断。用户在 ~53 列面板里能看到 `guard recent` 行尾的层级/来源标记（如 `[cache]`），80 列终端下日志与安装预览的长行同样完整。折行发生在 offset clamp 之前：先折行得总行数，再 clamp、再切片；`run-done` 贴底大 offset 语义与滚动指示符行为保持。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 无头断言：超宽回执行折行后，输出面板可见内容包含行尾标记（如 `[cache]`），且无静默丢字符
- [x] 无头断言：日志屏与安装预览面板的宽行同样折行（80 列宽度下断言）
- [x] resize 后下一次 render 按新宽度重折（视图状态仍只存原始行 + offset）
- [x] 贴底语义不回归：run-done 后仍显示输出尾部；滚动指示符不因折行错位
- [x] 双语（zh/en）与 `NO_COLOR` 渲染不破；`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿
