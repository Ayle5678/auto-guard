# 0009 — Issue 01：TUI 基座——终端驱动 + 帧渲染 + 状态机骨架

What to build:
- `packages/tui` 包骨架（package.json/tsconfig/vitest，照抄 cli 的形态；bin `auto-guard-tui` → `src/tui.ts`）。
- 驱动层 `src/term.ts`：raw mode 开关、alternate screen 进出、行级 diff 重绘（上一帧缓存 → 只重画变化行 + 清行）、SIGWINCH + 500ms 轮询双保险 resize、退出恢复（`process.on('exit')` 兜底；`restore()` 幂等）。
- 键盘事件归一 `src/keys.ts`：readline keypress → `{name, ctrl, meta, shift, ch}`；Ctrl+C 单击即退出（管理台无需双击）。
- 状态机骨架 `src/app.ts`：AppState（当前屏、焦点、busy、log）+ reducer（纯函数，键事件 + 动作结果事件进，新状态出）；`render(state)` 唯一渲染入口（本票先返回占位帧）。
- 非 TTY / `TERM=dumb` 拒绝启动：打印等价 CLI 提示，exit 2。

Blocked by: 无
Status: ready-for-agent

Acceptance:
- [ ] `node packages/tui/dist/tui.js` 在真终端显示占位帧，q / Ctrl+C 干净退出，终端状态完全恢复（光标、回显、主屏缓冲）
- [ ] 非 TTY（`echo | node …`）exit 2 + 提示；`TERM=dumb` 同
- [ ] 重绘无闪烁路径可观测（同帧不重画）；resize 后布局自适应新宽度
- [ ] reducer 与 keys 纯函数单测；`pnpm -r typecheck` 全绿
