# 0015 — 新宿主：Codex CLI（OpenAI）

## Spec

接入 **OpenAI Codex CLI** 单宿主（本机 codex-cli 0.151.0 实测深查）。走既有扩展路径（ADR-0007 能力声明 + ADR-0008 profile 数据驱动 + ADR-0016 描述符运行时），core 仅一处最小扩展（见下）。

### 协议结论（2026-08-30 官方文档 learn.chatgpt.com/docs/hooks + 二进制 strings 交叉验证）

- hooks 是 **Claude Code 协议的字段级同构**：`~/.codex/hooks.json`（或 config.toml 内联 `[hooks]`，两层会合并并告警——我们只写 hooks.json），`hooks.PreToolUse = [{matcher, hooks:[{type:"command", command, timeout(秒)}]}]`；matcher 是对 `tool_name` 的正则。多文件命中全部执行，与 config.toml 共存无害。
- PreToolUse 覆盖：shell/unified exec（`tool_name: "Bash"`，`tool_input.command` 为字符串脚本）、`apply_patch`（别名 `Edit`/`Write`，`tool_input.command` 为 V4A 补丁文本）、其余本地函数工具与 `mcp__server__tool`；托管工具（WebSearch 等）不经过 hooks。
- 输出：deny = `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason"}}` 或 exit 2 + stderr；allow 可显式输出（可带 `updatedInput` 重写）；**exit 0 无输出 = 正常流程**（不跳过沙箱审批——与 zcode/claude 同位：守卫只做加法）。
- **`permissionDecision:"ask"` 解析但不支持：hook 标记失败并继续执行**（等于静默放行，fail-open）。这是本宿主唯一的协议级坑。
- **信任门**：非托管 hook 首次运行前必须经 `/hooks` 人工信任（按内容 hash 记录，改动重审），未信任的 hook **静默跳过**；自动化可 `--dangerously-bypass-hook-trust` 单次放行。→ 安装器必须给 postInstall 警示。
- 事件含 SessionStart（matcher 匹配 `source`：startup/resume/compact/clear）。

### 设计决策

- **ask → deny（headlessFallback: 'deny'）**：PreToolUse 输出 ask 会被 codex 当 hook 失败并放行，绝不可发。翻译放 **默认 wire（运行时）**，由 `capabilities.headlessFallback === 'deny'` 驱动（dsh 先例的能力声明，描述符保持纯数据；opencode wire 不受影响）。deny reason = 原 ask 理由 + 「此宿主不支持人工确认，已按拒绝处理」提示（shared catalog 新键 `askDeniedNoPrompt`）。
- **apply_patch = 补丁文本提取**：`tool_input` 无 path/content 字段对，走不了既有字段链。`ToolMapping` 增纯数据槽 `patchCommand?: string`（承载补丁文本的字段名），extraction 解析 `*** Add/Update/Delete File:` + `*** Move to:` 头部得全部路径；GuardRequest 增可选 `paths`（多目标），**core decideFile 对全部路径过敏感路径门**（codex 单补丁常改多文件，只查首路径会漏 `.env`）。无可用路径 → unreviewable（fail-closed）。内容永不送审（decideFile 本就不读内容，与 write/edit 同纪律）。
- **workspace 兜底**：codex 不注入 CLAUDE_PROJECT_DIR 类 env；hook payload 自带 `cwd`。`workspaceFromEnv()` 增可选 fallback 参数：env 链 → payload `cwd` → `process.cwd()`。
- **allow = 静默**：exit 0 无输出，codex 沙箱审批照常——守卫纯加法（deny 危险、缓存/审计/学习），不代替宿主审批。不接 PermissionRequest hook（v1：PreToolUse deny 已覆盖全量访问模式；审批层短路留后续）。
- 守卫工具映射：`Bash`→bash；`apply_patch|Edit|Write`→edit（patchCommand: 'command'）。无 Read/Write 字段式工具，read 不接。MCP 工具不守卫（v1，passthrough）。
- 能力声明：`askStyle:'one-shot'`、`headlessFallback:'deny'`、`hasUI:false`、通知双 false（决策历史为通道）、`userBash:false`、`sessionState:'disk'`。
- 配置根：`~/.codex/auto-guard/`（ADR-0003）。
- 集成点：json-merge 写 `~/.codex/hooks.json`（array-append + markerSuffix，幂等/卸载与 claude 同机制，无新 op kind）。matcher `^(Bash|apply_patch|Edit|Write)$`；timeout PreToolUse 90 秒 / SessionStart 30 秒（claude 先例）。SessionStart matcher `^(startup|resume)$`。
- envNames 留空链 + 注释（身份来自 payload：session_id / cwd）。
- 无新 op kind：hooks.json 是标准 array-append（ADR-0008 门槛内）；协议决策与两处数据槽扩展记 ADR-0018。

### 通用

- 命名：HostId 增 `codex`；包 `@auto-guard/host-codex`（镜像 host-zcode 结构，dist 构建）。
- i18n：新增 `sessionNoteCodexHooksNoHotReload`、`codexTrustHint`、`codexVerifyHint`（MessageKey 类型强制对齐）。
- 契约套件按 `headlessFallback` 参数化 fail-closed 断言（'deny' → ladder 渲染 deny），codex 行接入 `describeHookHostContract`。
- conformance review-loop HOSTS 加 codex 行；smoke-codex.mjs 入根 smoke 链。
- 手册/README/CONTEXT.md 宿主清单 6→7；CONTEXT.md headless fallback 词条补 codex。

Design: ADR-0018（codex 宿主：hooks.json 通道 + ask→deny 能力翻译 + patchCommand/paths 数据槽）。

## Issues

- 01-runtime-patch-and-deny-fallback.md — host-runtime：patchCommand 提取 + GuardRequest.paths 敏感门 + cwd 兜底 + headlessFallback deny wire 翻译 + 契约套件参数化
- 02-host-codex-package.md — host-codex 包（描述符 + 能力 + 门面 + 契约/适配/输出测试）
- 03-codex-installer-profile.md — codex profile（hooks.json 写入/卸载 + tokens + i18n + 信任门警示）+ conformance/smoke 行
- 04-docs-and-live-verify.md — 文档矩阵 + 真机验证（codex exec 端到端 deny/allow，收口工单）

Status: done（2026-08-30 当日交付：全部工单完成，codex-cli 0.151.0 真机验证通过；唯一遗留 = 桌面 App（ChatGPT.app 内置 codex）内的 /hooks 信任流实机确认——同一集成已覆盖 App，见 04 工单 Comments）
