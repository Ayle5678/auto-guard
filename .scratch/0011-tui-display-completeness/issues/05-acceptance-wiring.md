# 05 — 验收接线：preview.txt、usage.md、三门禁全绿

**What to build:** 收口票：为本轮重生成无头预览帧（新 scratch 目录下的 make-preview 脚本 + preview.txt，覆盖 guard recent 折行、set 分组、帮助滚动、窄窗滚动等新场景），docs/usage.md 的 TUI 键位与交互描述同步（滚动键、set 分组、折行行为），并对 SPEC 0011 验收清单逐条核对、三个门禁（typecheck / test / smoke）全绿。

**Blocked by:** 01, 02, 03, 04 — 全部前置票完成后收口。

**Status:** done（2026-08-30 核对：实现与验收复选框均已就位，补记状态）

- [x] preview.txt 重生成，包含折行/滚动/分组的演示帧
- [x] docs/usage.md §6（TUI）键位与交互描述与实现一致
- [x] SPEC 0011 验收清单逐条核对通过
- [x] `pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿
