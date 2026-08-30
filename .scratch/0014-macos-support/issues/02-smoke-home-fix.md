# 02 — smoke-zcode 补 HOME + 全脚本核对

What to build:

- `scripts/smoke/smoke-zcode.mjs:24` 的 env 补 `HOME: home`（对齐 smoke-claude.mjs:19 / smoke-qoder.mjs:21 / smoke-lang.mjs:29 的 USERPROFILE + HOME 双设）。
- 核对全部 `scripts/smoke/*.mjs` 与 `scripts/` 下其他脚本：凡伪造用户目录处，`USERPROFILE` 与 `HOME` 必须双设（review-loop.mjs:244 已双设，作为参照）。

Blocked by: —

Status: done（2026-08-30）

Acceptance:

- [x] smoke-zcode 通过且只触碰临时目录——父进程 HOME/USERPROFILE 指向真实目录运行 smoke-zcode：PASS，真实 `~/.zcode/cli/` 前后 `ls` 一致、零新增文件；全 8 个 smoke 脚本在 `pnpm smoke` 下全 PASS
- [x] grep 确认全部 smoke 脚本双设，无一遗漏——claude / qoder / lang 为 spawn env 双设；opencode 为 `process.env` 双设；zcode 本次补齐；pi / dsh / tui 不伪造用户目录（纯适配映射 / 非 TTY 拒绝，触不到 `~`）；`packages/conformance/review-loop.mjs` 参照实现本就双设
