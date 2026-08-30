# 01 — engines 下限实测钉死 + README 双声明修正

What to build:

- 实测钉死最低 Node 版本：候选 **22.18**（type stripping 默认开启、`node:sqlite` 无标志、原生可选依赖 ≥22 三者取大）；用该版本真跑 `auto-guard init` / `guard ping` / 一例 smoke 验证，有出入则以实测值为准（smoke 脚本内现有 "needs Node >= 23" 注释一并核对对齐）。
- 全部 package.json（root + 各包）`engines.node` 同步为钉死值。
- `README.md:159`「Node ≥ 20, zero external deps」双声明修正，README.zh-CN.md 对应行同步：真实下限 + 诚实表述（core 零运行时依赖、SQLCipher 审计为可选原生依赖、失败自动降级）。

Blocked by: —

Status: done（2026-08-30，darwin arm64 实测）

Acceptance:

- [x] 钉死版本上 init / guard ping / smoke 各一例通过——Node 22.18.0 实跑：`init --host zcode --yes` exit 0（hooks 写入 + `.auto-guard/config.json` 落盘）、`guard status` / `guard ping` 结构化输出（ping 按设计 fail-closed 报缺 key）、smoke-pi / smoke-dsh / smoke-zcode 全 PASS；反向验证：20.19.5 与 22.17.1 的 `init` 均 `ERR_UNKNOWN_FILE_EXTENSION .ts` 硬失败，22.18 即精确下限，与候选一致。`node:sqlite` 在 22.18 无标志可用（仅 ExperimentalWarning）
- [x] 全包 engines 一致；README 双语声明与实际一致——root + 11 包 `engines.node` 同步 `>=22.18.0`；README.md:159 / README.zh-CN.md:156 改为「Node ≥ 22.18，实测下限；core 零运行时依赖 + SQLCipher 审计为可选原生依赖、缺失自动降级」
- [x] `grep -r '"node": ">=20"' --include=package.json` 无残留（0 条）

顺带对齐（同一事实的其余表述）：usage.md 三处「Node ≥ 20 / Node 23+」→ 22.18 口径；smoke-pi / smoke-dsh 的 "needs Node >= 23" 注释与 skip 文案 → 22.18。
