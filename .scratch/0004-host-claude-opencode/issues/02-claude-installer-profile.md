# 02 — claude 安装器 profile

What to build:
- `profiles.ts` 增 claude profile（沿用工单基线 commit 的安装器形态，不含 main 未提交的 i18n 改动；会话提示沿用中文字面量约定，与双语分支合并时再对齐消息键）：
  - detection：dirs `['.claude']`，files `['.claude/settings.json']`，executables `['claude']`。
  - action json-merge → `~/.claude/settings.json`：`hooks.PreToolUse` + `hooks.SessionStart` 两条 entry（镜像 zcode 模板风格）；PreToolUse matcher `^(Bash|Read|Write|Edit|NotebookEdit)$`，SessionStart matcher `^(startup|resume)$`；命令 `node <dist 产物>`。
  - 新 token：`AUTO_GUARD_CLAUDE_HOOK_CLI`、`AUTO_GUARD_CLAUDE_SESSION_START` 进 `PackagePaths` + `TOKENS`；requiredTokens 校验。
  - markerSuffix：`/host-claude/dist/hook-cli.js`、`/host-claude/dist/session-start.js`。
- init 完成输出追加两行：`guard ping` 验证提示；cc-switch/clawd 会整体覆写 settings.json 抹掉 hooks 的警示。
- remove 幂等还原（既有 json-merge remove 语义覆盖，无需新逻辑）。

Blocked by: 01
Status: done

Acceptance:
- [x] validateProfile 通过；空配置 / 已有用户 hooks 的 settings.json 写入幂等、写前备份 `*.auto-guard.bak`、可 remove 完整还原
- [ ] init 冒烟：真实 `claude` 会话中 PreToolUse 触发（deny 样例命令被拦）——待人工：本机 Claude Code 会话验证（docs/usage.md claude 警示段含自检步骤）
