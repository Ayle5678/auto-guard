# 12 — 文档、发布与旧库收尾

What to build:
- 根 README（英文 + README.zh-CN.md）：定位、三宿主对照表、安装方式（原生渠道 + SPEC 0002 安装器）、配置项全表（超集 schema）、从三个旧包迁移指南（卸旧装新、数据原地续用）。
- `docs/differences.md`：与三前代的行为差异清单（timeoutMs 8000、pi key 加密、审计实现差异等），前代用户可核对。
- 三旧仓库收尾文本：README 顶部指向本仓库 + archived 建议文本（执行归档由维护者手动做，本文只产文案与步骤）。
- 发布：统一包版本 0.3.0；dsh/pi/zcode 各分发渠道的发布产物清单与步骤。

Blocked by: 11
Status: done

Acceptance:
- [x] 三份 README（根 ×2 语言 + 差异文档）评审通过，配置项与代码 DEFAULT_CONFIG 逐键一致
- [x] 迁移指南含"旧配置文件是否兼容"逐项回答（是，路径与 schema 不变）
- [x] 0.3.0 tag 与三渠道产物清单齐备

## Comments

- 2026-08-28: done — README (en/zh) with host matrix, install channels, config table keyed against defaultGuardConfig, migration guide; docs/differences.md per-predecessor deltas; docs/cutover/legacy-repos.md banner text + steps; docs/release-0.3.0.md channel artifact list; docs/cli.md incl. PowerShell alias
