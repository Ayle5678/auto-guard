# 04 — 文档 + 真机验证（收口）

Status: done（2026-08-30 完成并附证据）

Spec 0015。

## Scope

- README.md / README.zh-CN.md：宿主矩阵 6→7，codex 一行（hooks.json 渠道 + 信任门警示）。
- docs/usage.md：§2.6 宿主写入对照表加行；codex 专属警示段（/hooks 信任、ask→deny 语义、apply_patch 提取范围）。
- docs/cli.md：宿主 id 列表如提及则补 codex。
- CONTEXT.md：宿主清单 6→7；headless fallback 词条补 codex（ask→deny）。
- ADR-0018：codex 宿主决策记录（协议同构与 ask 坑、hooks.json 通道、headlessFallback 驱动的默认 wire 翻译、patchCommand/paths 数据槽、allow=静默不加法立场）。
- docs/grill-log.md：追加 Round 13（codex 协议深查自问自答）。
- **真机验证**：构建后安装器写入真实 `~/.codex/hooks.json`；`codex exec --dangerously-bypass-hook-trust` 各驱动一次 apply_patch 触 `.env`（期望 PreToolUse deny 抵达模型）与 git status（期望静默放行）；核对 `~/.codex/auto-guard/` 决策历史落库。交互式使用的 /hooks 信任步骤在交付说明中交代（自动化无法代替）。

## Accept

- 文档矩阵一致；真机 deny/allow 各一例证据（决策历史行）。

## Comments

- 2026-08-30 真机证据（codex-cli 0.151.0，homebrew；会话 01a05331-d948-7fb2-92d7-fad467ea06d4）：
  - deny：`codex exec` 驱动 apply_patch 写 `.env` → 日志 `hook: PreToolUse` → `ERROR codex_core::tools::router: Command blocked by PreToolUse hook: [Auto Guard] ❓ 询问 [敏感路径]: … .env 【本宿主无法弹出人工确认…已按拒绝处理…】` → `hook: PreToolUse Blocked`，模型复述被拦；`.env` 未创建。
  - allow：`git status --short` 静默执行成功。
  - 决策历史 `~/.codex/auto-guard/decision-history.jsonl`：`ask | sensitive-path | apply_patch | .env` 与 `allow | static-allow | Bash | git status --short` 两行；history subject 对 apply_patch 正确取首个补丁路径。
  - 安装器：`init --host codex --yes` 写入 hooks.json + 备份；`list` 正确识别 codex（config.toml + 可执行文件双证据）。
- 桌面 App 结论（同日）：ChatGPT.app 内置 codex 二进制 0.151.0-alpha.7.2 含完整 hook_runtime（PreToolUse/hooks.json 字符串俱在），与 CLI 共享 `~/.codex`——同一 hooks.json 覆盖 App 会话；App 内信任 UI 形态待用户实机确认（跑一条命令后 `guard recent --config-root ~/.codex/auto-guard` 可见即命中）。
- 交付说明：交互式使用前需在 Codex 中执行一次 `/hooks` 信任两条目；`codex exec --dangerously-bypass-hook-trust` 仅限自动化。
