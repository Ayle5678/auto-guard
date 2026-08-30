# 0012 — qoder delete_file 纳入守卫（bash 删除合成）

## Spec

撤销 SPEC 0005 的范围裁剪「delete_file 不守卫（v1）」：Qoder 特有的文件删除工具 `delete_file`（snake_case 单数，名称实证于 `0005/research/qoder-hooks-protocol.md`）纳入守卫。用户 2026-08-30 拍板：「当做我们的 bash 删除来守卫」。

方案（Option A，用户拍板）：

- 安装器 qoder profile 的 PreToolUse matcher 追加 `delete_file`。子串安全已核对：与既有九名（Bash|Read|Write|Edit|apply_patch|run_in_terminal|read_file|create_file|search_replace）互不为子串，管道精确匹配与正则子串匹配两种解释下都只命中自身。
- 适配层 `GUARDED_TOOL_NAMES` 加 `delete_file → 'bash'`，把入参路径**合成**为 `rm "<路径>"` 作为 GuardRequest.command 送入裁决管线——与真 bash 单文件 `rm` 完全同流：必经 LLM（`rm` 无静态放行模式，永不静默放行）、命中敏感路径降级复核、审查器故障 fail-closed。
- 路径取不到 → unreviewable（fail-closed ask），绝不放行。`tool_input` 字段名官方未公布 schema，沿用防御链 `file_path→filePath→filepath→path`。
- 合成命令是本仓首个「适配层合成 shell 命令」先例（此前六宿主 command 全部原样透传）——因此独立成票、独立测试，不与 SPEC 0013 运行时迁移混合；0013 的 qoder 移植票把它当既有行为携带。

拒绝项：合成 `rm -rf` 走两段式目录删除复核（Option B）——两段式是 ADR-0012 为**递归目录删除**定制的纪律，单文件删除不匹配其语义；B 会使 qoder 比等价 bash `rm` 更严，制造跨宿主裁决不一致（conformance 主张恰是等价）；`[删除理由]` 标记协议嵌在命令字符串里，在 delete_file 的 path 字段上无处安放。若日后证实 delete_file 可递归删目录（当前未知），升级为一行映射改动（`rm` → `rm -rf`，两段式自动生效）。要整体收紧删除纪律的正确杠杆是规则层——真 bash `rm` 与合成 `rm` 同时变严。

Design: 无新 ADR（单一映射的行为变更，非架构决策；Option B 的拒绝推理记入本 spec 与 grill-log Round 11）。

## Issues

- 01-qoder-delete-file-guard.md — matcher + 工具表映射 + rm 合成 + 测试反转 + 四处文档披露清除

Status: done
