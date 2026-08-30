# 0010 — Issue 05：验收接线——preview 重生成 / spec 勾选 / docs 键位 / handoff

What to build:
- 重生成 `.scratch/0010-tui-ux-polish/preview.txt`（headless 帧自检：dashboard 含字标 / guard 含状态面板与 autoload 后输出 / 安装屏 / 帮助屏 / 命令模式，与 0009 预览同格式、可直接人工比对）。
- spec 0010 验收清单逐项勾选（引用断言 / 测试名）。
- `docs/usage.md` §6 键位描述更新（`←→ 切屏`、`Tab/Shift+Tab` 子页、数字跳转）；`README.zh-CN.md` / `README.md` 若有旧键位文案一并核对。
- 本 `handoff.md` 收尾（状态 / 会话日志 / 真终端人工验收清单：方向键切屏、autoload 首访填充、banner 显示与降级、notice 闪烁、双语切换、NO_COLOR）。
- 三门禁：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿。

Blocked by: 04
Status: done

Acceptance:
- [x] preview.txt 重生成且人工可读（与实现一致）
- [x] docs 键位描述与实现一致（grep 无「1-8 切屏」旧文案残留）
- [x] 三门禁全绿
- [x] handoff 收尾完成

## Comments

- 2026-08-30: 完成。preview.txt 经 make-preview.mjs（本目录，headless 注入演示数据）重生成：110×30 字标 / guard-examine-set 自动加载 / 安装 status 子页 list / 日志回执与 notice / 命令模式 / 100×30 与 40×12 降级，共 10 帧。spec 验收全勾；docs/usage.md §6 键位与新约定更新；三门禁全绿（typecheck Done / 805 tests / smoke 15 PASS）。待用户真终端验收后提交。
- 2026-08-30（code-review 修复轮）: 审查轮后复查：spec 正文补记 0009 clamp 回归修复；grill-log Round 9 Q14 陈旧阈值（62×16）与 Q6/代码同步为 110×20；三门禁复跑全绿（805 tests / typecheck 10 包 Done / smoke 15 PASS），preview.txt 重生成。
