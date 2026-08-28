# 01 — host-claude 适配层

What to build:
- `packages/host-claude/`（@auto-guard/host-claude，Node 内置模块零依赖，镜像 host-zcode 结构）：
  - `claude-adapter.ts`：Claude 兼容 hook payload（snake_case + camelCase 回退，参照 `zcode-adapter.ts`）→ GuardRequest；`GUARDED_TOOL_NAMES`：Bash/Read/Write/Edit/NotebookEdit（NotebookEdit→edit；文件路径回退链 notebook_path/file_path/path）；不可解析 payload → unreviewable（fail-closed，调用方转 ask）。
  - `claude-capabilities.ts`：`askStyle: 'native'` + `headlessFallback: 'host'` + hasUI true；notify/userBash/sessionState 取值对齐 `zcode-capabilities.ts` 现状。
  - `hook-output.ts`：Decision → Claude Code PreToolUse 输出（`hookSpecificOutput.permissionDecision: allow|deny|ask` + `permissionDecisionReason`；实现期以官方 hooks 文档核对字段与转义）。
  - `hook-cli.ts`：stdin→GuardService→stdout；catch-all 输出 deny 级决策（fail-closed）；Windows 纪律沿用（自然退出、退出码 0/2）。
  - `session-start.ts` + `bootstrap.ts`：镜像 zcode（provisioning + 会话初始化）。

Blocked by: —
Status: done

Acceptance:
- [ ] 单测：五类工具 payload→GuardRequest 翻译、NotebookEdit 映射、不可解析 payload→unreviewable
- [ ] 单测：Decision→permissionDecision 三态输出；异常输入 fail-closed
- [ ] 集成冒烟：`node dist/hook-cli.js` 吃样例 payload 出正确 JSON
