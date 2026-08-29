# 0009 — Issue 08：打磨与验收——smoke / 门禁 / handoff 收尾

What to build:
- `scripts/smoke/smoke-tui.mjs`：两断言——非 TTY 启动 exit 2 + 提示；`--help`（若实现）或占位渲染路径不炸。进根 `pnpm smoke` 链。
- 全量门禁：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke`（六宿主原有 smoke 不回归）。
- 人工验收清单跑一遍（真终端）：spec「验收」节全部勾选；重点：q/Ctrl+C/Esc 退出终端恢复、resize 不花屏、中英混排对齐、set-key 掩码、危险操作确认。
- `handoff.md` 收尾更新（最终状态、已知限制、后续候选——如统一 CLI `set set-key` 修复票、主题化、鼠标支持）。

Blocked by: 04, 05, 06, 07
Status: ready-for-agent

Acceptance:
- [ ] smoke-tui 进链且全绿
- [ ] spec 验收清单全部勾选
- [ ] handoff.md 反映最终状态；票据 Status 全部 done
