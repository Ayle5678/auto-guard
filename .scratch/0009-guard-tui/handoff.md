# 0009 — Handoff：Guard TUI 交接文档（活文档，每次会话结束前更新）

> **接手第一步**：读本文件 → 读 `spec.md` → 扫 `issues/` 的 `Status:` 行找 frontier → 干活。
> 设计推理在 `docs/grill-log.md` Round 8（Q23–Q30），架构结论在 `docs/adr/0014`。

## 当前状态：**实施完成，待真终端人工验收**（2026-08-30 会话 1 收尾）

- [x] 设计文档全套（spec / ADR-0014 / tickets / grill-log Round 8 / CONTEXT 词条）
- [x] 票据 01–08 全部 `done`（各票 Comments 有实现记录与偏离说明）
- [x] `packages/tui` 实现完成：驱动层 + 纯渲染组件 + 八屏 + 向导 + `:` 命令模式 + 双语
- [x] 门禁全绿：`pnpm -r typecheck` / `pnpm -r test`（tui 50 项）/ `pnpm smoke`（含新 smoke-tui）
- [x] 文档接线：README / README.zh-CN / docs/cli.md / docs/usage.md §6
- [ ] **待用户真终端人工验收**（见下）

## 真终端人工验收清单（用户跑，5 分钟）

```bash
cd D:/yilun/yilun_project/auto-guard-tui
node packages/tui/dist/tui.js        # 或先 pnpm build
```

- [ ] 启动即全屏；q / Ctrl+C 退出后终端完全恢复（光标、回显、回滚缓冲）
- [ ] 1–8 切屏、↑↓/jk、Enter 执行；总览 Enter 换根；p ping 出回执
- [ ] `:` 进命令模式跑 `guard status` → 日志屏可见回执与退出码
- [ ] 密钥屏跑 set-key 向导（掩码可见、Esc 可取消）→ show-key 面板变化
- [ ] 审计屏 clear-all 弹红框、Esc 取消不落盘
- [ ] 安装屏：勾选宿主 → 规则选择 → 预览 → 确认/取消（取消零写入）
- [ ] 拖拽终端窗口尺寸，界面自适应不花屏
- [ ] `set lang en` 后整屏切英文不错位

## 工作区

- 主检出：`D:\yilun\yilun_project\auto-guard`（main，**不动**）
- 本 worktree：`D:\yilun\yilun_project\auto-guard-tui`，分支 `feat/guard-tui`（`git worktree list` 可查）
- 依赖已装；门禁：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke`（worktree 根跑）
- 渲染样例：`.scratch/0009-guard-tui/preview.txt`（headless 帧自检）

## 源码地图（已实现）

```
packages/tui/
  src/tui.ts        bin 入口（TTY 检查 + 主循环 + 效果执行 + 退出纪律）
  src/term.ts       驱动层：raw mode / alt screen / 行 diff 重绘 / resize / 幂等恢复
  src/keys.ts       keypress 归一
  src/app.ts        AppState + reducer + 帧合成（header/nav/body/dialog/input/footer）
  src/actions.ts    runCli / runInstallerCommand 代理 + 结构化读 + 向导保存 + 安装预览
  src/i18n.ts       TUI 铬件双语目录（四层解析复用 core）
  src/types.ts      共享类型（含 Effect / WizardInput / IntegratedDetection）
  src/paths.ts      路径显示（tilde 折叠）
  src/ui/text.ts    CJK 宽度 / 截断 / 填充 / 换行
  src/ui/theme.ts   色板 + SGR（NO_COLOR 退化）+ Seg/Row 模型
  src/ui/kit.ts     powerline 头 / 页签 / 面板 / 列表 / 勾选框 / 确认框 / 内联输入 / 滚动 / footer
  src/screens/      dashboard / lists(guard·examine·optimize·set) / installer / log / help
  tests/            50 项：text/kit/term/keys/actions/app/installer/i18n
```

## 关键决策速记（细节见 ADR-0014 / grill-log Round 8，不要重新发明）

1. 零依赖手写 ANSI（不用 Ink/React）；渲染 = 纯函数 `render(state) → Row[]`，驱动层薄。
2. 动作全走 `runCli` / `runInstallerCommand`；安装器调用强制注入非交互 deps（readline 不得抢 raw-mode 终端）。
3. `set set-key` 在 TUI 自实现向导（统一 CLI 该命令目前无条件拒绝——已知文档-实现不一致，记录在 spec，**未在分支内修 cli**）。
4. `packages/cli` 只加了 exports 映射（`./shell`、`./status-store`、`./installer*`、`./installer/integration`）。
5. 非 TTY / TERM=dumb 拒绝 exit 2；退出三恢复挂 `process.on('exit')`；`process.exitCode` 自然退出。
6. run-done 视图 offset 用大数 + panel 内 clamp 实现"贴底"。
7. **有意偏离（票 06）**：未检测宿主在安装屏锁定不可勾选（CLI `--host` 路径 fail-closed + manual-confirm 需要 readline 终端），行内注明。

## 后续候选（未排期）

- 统一 CLI `set set-key` 修复票（shell.ts 无条件拒绝 vs docs 三步向导的说法——独立小票，动管理命令语义需单独评审）
- 主题化 / NO_COLOR 之外的配色方案、鼠标支持（spec 非目标，v2 再议）
- `auto-guard tui` 子命令入口（在 cli shell 加转发；目前独立 bin `auto-guard-tui`）
- 发布为 npx 可装包后的安装器集成（init 完成后提示一键进 TUI）

## 会话日志

- 2026-08-30 会话 1：调研（CLI 命令面 + ccstatusline）→ worktree/分支 `feat/guard-tui` → 设计文档全套落盘（commit 1168206）→ 实施完成（8/8 票）→ 门禁全绿 → 文档接线 → 本文件收尾。
