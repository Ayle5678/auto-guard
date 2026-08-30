# 0010 — Handoff：Guard TUI 交互与视觉 2.0（活文档，每次会话结束前更新）

> **接手第一步**：读本文件 → 读 `spec.md` → 扫 `issues/` 的 `Status:` 行找 frontier → 干活。
> 设计推理在 `docs/grill-log.md` Round 9（Q1–Q18，自问自答）；架构沿用 `docs/adr/0014`。

## 当前状态：**实施完成，待用户真终端验收后提交**（2026-08-30 会话 1）

- [x] grill Round 9 落盘（`docs/grill-log.md`，含 Q6 阈值实施修正注记）
- [x] spec 落盘 + 验收全勾（本目录 `spec.md`）
- [x] 票据 01–05 全部 `done`（各票 Comments 有实现记录与两处顺手修复说明）
- [x] `packages/tui` 交互与视觉 2.0：全局方向键切屏 + notice + autoload + 状态面板 + 品牌字标 + 圆角/药丸/键帽 chrome
- [x] **回归修复（0009 遗留）**：回执贴底 offset 未 clamp → 列表/安装/日志屏输出面板被切空（用户抱怨「输出框里什么也没有」的根因）
- [x] 三门禁全绿：`pnpm -r typecheck` / `pnpm -r test`（805 项，tui 67）/ `pnpm smoke`（15 PASS）
- [x] preview.txt 重生成（make-preview.mjs，10 帧）+ docs/usage.md §6 键位更新
- [ ] **用户真终端验收 → 提交**（用户要求：提交前过目）

## 真终端人工验收清单（用户跑，3 分钟）

```bash
cd D:/yilun/yilun_project/auto-guard-tui
pnpm build && node packages/tui/dist/tui.js   # 或 node packages/tui/src/tui.ts
```

- [ ] `←` `→`（或 h/l）在页面栏循环切屏，页签高亮跟随；数字 1-8 仍可跳转
- [ ] 安装屏 `Tab` / `Shift+Tab` 换子页
- [ ] 首次进守卫/审计/优化/密钥屏：输出面板自动填充（守卫屏出最近裁决），日志屏不被自动加载污染
- [ ] `r` 刷新：footer 闪「已刷新」且当前屏重跑自动加载
- [ ] 总览屏 ≥110 列显示 AUTO GUARD 渐变字标；拖窄窗口字标消失、布局不破
- [ ] `set lang en` 整屏英文不错位；`NO_COLOR=1 node …` 无色可运行
- [ ] q / Ctrl+C 干净退出（0009 纪律未动）

## 工作区

- worktree：`D:\yilun\yilun_project\auto-guard-tui`，分支 `feat/guard-tui`
- 门禁：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke`（worktree 根跑）
- 渲染样例：`.scratch/0010-tui-ux-polish/preview.txt`（`node .scratch/0010-tui-ux-polish/make-preview.mjs` 重生成）

## 关键决策速记（细节见 spec / grill-log Round 9 / 各票 Comments，不要重新发明）

1. `←→/hl` 全局切屏（循环）；数字 1-8 降级快捷键；安装屏子页 = `Tab/Shift+Tab`。
2. autoload 只读命令填输出面板，**不写 receipts**，busy 串行化，`r` 重跑，`autoloaded` 标记防重复。
3. 状态面板归位：左 = 状态 + 动作，右 = 输出；examine/optimize 补状态面板（RootSummary 读）。
4. banner = cli `renderBannerGrid` 素导出 + TUI Seg 化 256 色渐变；阈值 `110×20`（整幅 108 列）。
5. notice 零定时器：footer 左侧 accent 段，下一次按键消失。
6. sgrOf 256 色分支仅 banner 用；chrome 禁 emoji；面板圆角 `╭╮╰╯`；滚动槽仅首行指示符。

## 会话日志

- 2026-08-30 会话 1：用户三点不满（无 banner / 死键与空输出 / 数字键切页）→ grill 自问自答三轮收敛（Round 9）→ spec/票据落盘 → 5 票实施完成 → 发现并修复 0009 输出面板切空回归 → 三门禁全绿 + preview 重生成 → 停在提交前等用户过目。
