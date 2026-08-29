# 0009 — Handoff：Guard TUI 交接文档（活文档，每次会话结束前更新）

> **接手第一步**：读本文件 → 读 `spec.md` → 扫 `issues/` 的 `Status:` 行找 frontier（未 done 且无未完成 blocker 的最小号票）→ 干活。
> 设计推理背景在 `docs/grill-log.md` Round 8（Q23–Q30），架构结论在 `docs/adr/0014`。

## 工作区

- 主检出：`D:\yilun\yilun_project\auto-guard`（main，**不动**）
- 本 worktree：`D:\yilun\yilun_project\auto-guard-tui`，分支 `feat/guard-tui`（`git worktree list` 可查）
- 依赖已装（pnpm install 完成）；门禁命令都在 worktree 根跑：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke`
- 人工验收需真终端：`node packages/tui/dist/tui.js`（先 `pnpm -r build`）或直接 `node --experimental-strip-types packages/tui/src/tui.ts`（Node ≥23.6 免构建）

## 关键决策（详见 ADR-0014 / grill-log Round 8，不要重新发明）

1. 零依赖手写 ANSI（不用 Ink/React）；渲染 = 纯函数 `render(state) → string[]`，驱动层薄。
2. 动作全走 `runCli` / `runInstallerCommand` 代理（单一事实源）；结构化读才直接调 core/cli 读函数。
3. `set set-key` 在 TUI 自实现三步向导（统一 CLI 该命令目前无条件拒绝——已知文档-实现不一致，记录在 spec，**不要在本分支修 cli**）。
4. `packages/cli/package.json` 只允许加 exports 映射，逻辑零改动。
5. 非 TTY 拒绝 exit 2；退出三恢复挂 `process.on('exit')`；自然退出纪律（exitCode）。
6. 双语四层解析；CJK 显示宽度自算（对齐是「精美」的地基）。

## 源码地图（实施时填）

```
packages/tui/
  src/tui.ts        bin 入口（TTY 检查 + 主循环）
  src/term.ts       驱动层：raw mode / alt screen / 行 diff 重绘 / resize / 恢复
  src/keys.ts       keypress 归一
  src/app.ts        AppState + reducer + 屏状态机
  src/actions.ts    runCli / runInstallerCommand 代理 + 日志事件
  src/i18n.ts       TUI 铬件双语目录
  src/ui/text.ts    CJK 宽度 / 截断 / 填充
  src/ui/theme.ts   色板 + SGR（NO_COLOR 退化）
  src/ui/kit.ts     powerline 头 / 页签 / 面板 / 列表 / 滚动 / 确认框 / 内联输入 / spinner / footer
  src/screens/      八屏（dashboard/guard/examine/optimize/set/installer/log/help）
  tests/            纯函数单测（render 断言 / reducer 状态机 / actions 注入假 deps）
```

## 状态快照（更新于：2026-08-30 会话 1）

- [x] 设计文档全套落盘：spec / ADR-0014 / tickets 01–08 / grill-log Round 8 / CONTEXT 词条 / 本文件
- [ ] 01 驱动基座 — Status: ready-for-agent
- [ ] 02 渲染组件层 — Blocked by: 01
- [ ] 03 命令接驳 + `:` 命令模式 — Blocked by: 02
- [ ] 04 总览+守卫屏 — Blocked by: 03
- [ ] 05 审计+优化+密钥屏 — Blocked by: 03
- [ ] 06 安装屏 — Blocked by: 03
- [ ] 07 i18n+帮助+文档 — Blocked by: 03
- [ ] 08 打磨验收 — Blocked by: 04,05,06,07

## 已知坑（前人踩过）

- Windows：SIGWINCH 覆盖不全，resize 要加轮询双保险；`process.exit()` 会跳过 exit 钩子留下坏终端（用 exitCode）。
- readline 行式交互与 raw mode 按键捕获互斥——安装器 readline 流程不能直接搬，要用 TUI 自己的组件重排（票 06）。
- runCli 的输出行是纯文本（无色），进面板前不做 SGR 假设。
- `guard status` 无显式根时是聚合视图且**不落盘**（读视图）；TUI 总览屏复刻该语义，别用 io.load() 去碰 unseeded 根（会播种副作用）。
- core 的 `recentLines`/`statusLines` 等需要 `lang` 参数——用当前根解析出的语言传。

## 会话日志

- 2026-08-30 会话 1：调研（CLI 命令面 + ccstatusline）、开 worktree、设计文档全套落盘并提交；实施待开始。
