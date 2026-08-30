# 0014 — macOS 支持：审计修复 + 真机验证

## Spec

2026-08-30 mac 兼容性审计（子代理逐文件扫描，结论与证据记入 grill-log Round 12）判定：产品代码跨平台纪律成立，mac 可用；发现四个疏漏需修、六项事实需真机验证。本 spec 落实 ADR-0017 的 v1 档位——修复 + 机会性验证，不买 mac CI、不承诺全宿主真机矩阵。

审计要点（修复的依据）：

- 全部 win32 分支均有 POSIX 回退（`detect.ts:60`、`integration.ts:137-147`、`guard-service.ts:1121`、`command.ts:212-221`）；配置根全走 `homedir()+join`；安装器写值为安装期替换的字面路径（`profiles.ts:345-354`）；加密纯 node:crypto；TUI 纯 ANSI。
- 疏漏 1：`scripts/smoke/smoke-zcode.mjs:24` 只设 `USERPROFILE` 不设 `HOME`——mac 上冒烟会读写真实 `~/.zcode`（其余 smoke 脚本均双设）。
- 疏漏 2：全部 package.json `engines: >=20` 低于实际下限——bin 是 TS 源码直跑（type stripping 需 22.18+/23.6+）、`node:sqlite`（22.5+）、原生可选依赖 ≥22；Node 20/21 任何平台 `init` 硬失败。
- 疏漏 3：docs 无 mac 故事——cli.md 只有 PowerShell alias 安装法，终端清单只列 Windows 终端。
- 疏漏 4：README.md:159「Node ≥ 20, zero external deps」两半都不准。

真机验证清单（无法从代码判定，需一台 mac）：Qoder mac 配置位置（`~/.qoder/settings.json` vs `~/Library/Application Support/Qoder/`）、ZCode mac 配置位置、`better-sqlite3-multiple-ciphers` darwin 预编译有无、dsh/pi 可用性与 claude/opencode PATH 检测、Claude Code mac hook 的 shell 行为、Terminal.app / iTerm2 的 TUI 实测（Option 键默认 ESC 前缀、resize、CJK 对齐）。

Design: ADR-0017。无 CONTEXT.md 增补——平台矩阵是工程姿态不是领域概念，归 ADR 与 docs 表述。

## Issues

- 01-engines-floor.md — engines 下限实测钉死 + README 双声明修正
- 02-smoke-home-fix.md — smoke-zcode 补 HOME + 全脚本核对
- 03-docs-macos.md — mac 安装文档 + 终端矩阵 + 支持状态标注
- 04-real-mac-verification.md — 真机验证清单与回写（需人 + 一台 mac）

Status: open
