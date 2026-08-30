# 02 — smoke-zcode 补 HOME + 全脚本核对

What to build:

- `scripts/smoke/smoke-zcode.mjs:24` 的 env 补 `HOME: home`（对齐 smoke-claude.mjs:19 / smoke-qoder.mjs:21 / smoke-lang.mjs:29 的 USERPROFILE + HOME 双设）。
- 核对全部 `scripts/smoke/*.mjs` 与 `scripts/` 下其他脚本：凡伪造用户目录处，`USERPROFILE` 与 `HOME` 必须双设（review-loop.mjs:244 已双设，作为参照）。

Blocked by: —

Status: ready-for-agent

Acceptance:

- [ ] smoke-zcode 通过且只触碰临时目录（可临时改真实 HOME 验证隔离性后还原）
- [ ] grep 确认全部 smoke 脚本双设，无一遗漏
