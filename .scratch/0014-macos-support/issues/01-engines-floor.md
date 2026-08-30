# 01 — engines 下限实测钉死 + README 双声明修正

What to build:

- 实测钉死最低 Node 版本：候选 **22.18**（type stripping 默认开启、`node:sqlite` 无标志、原生可选依赖 ≥22 三者取大）；用该版本真跑 `auto-guard init` / `guard ping` / 一例 smoke 验证，有出入则以实测值为准（smoke 脚本内现有 "needs Node >= 23" 注释一并核对对齐）。
- 全部 package.json（root + 各包）`engines.node` 同步为钉死值。
- `README.md:159`「Node ≥ 20, zero external deps」双声明修正，README.zh-CN.md 对应行同步：真实下限 + 诚实表述（core 零运行时依赖、SQLCipher 审计为可选原生依赖、失败自动降级）。

Blocked by: —

Status: ready-for-agent

Acceptance:

- [ ] 钉死版本上 init / guard ping / smoke 各一例通过
- [ ] 全包 engines 一致；README 双语声明与实际一致
- [ ] `grep -r '"node": ">=20"' --include=package.json` 无残留
