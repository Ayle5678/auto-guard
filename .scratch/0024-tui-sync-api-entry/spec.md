# 0024 — TUI 统一评审 API 入口：密钥屏一行 sync-api，不进命令行

> Status: resolved
> 决策依据：SPEC 0023（sync-api 命令面）、ADR-0014（TUI 零依赖 + 动作即 runCli）。不设新 ADR。

## Problem Statement

SPEC 0023 的 `sync-api` 只能从 shell 跑（或 TUI `:` 命令模式盲打）。多宿主用户在 TUI 里切评审 API 仍要记住命令语法；密钥屏的 API 端点组只有单根动作（set-api base/model/reset），没有「全部宿主一次切换」的可发现入口。

## Solution

密钥屏 API 端点组新增一行「统一评审 API（sync-api）」，三步输入链 + 确认框，全程复用既有 TUI 机制（ActionItem.ask 链式输入 = set-key 向导同款、确认框 = 确认 pending run）：

1. `sync-base` 输入（预设当前根 apiBase，Enter 保留）→
2. `sync-model` 输入（预设当前根 model）→
3. `sync-propagate` 输入（y/N，缺省 N）→
4. 确认框（显示 base/model/是否传播 Key）→ 确认执行 `runCli(['sync-api', base, model] (+ '--propagate-key'))`。

语义零新增：argv 由引擎既有 `sync-api` 分支执行，回执与命令行逐字一致；`--config-root` 仍由驱动按当前根注入（= Key 传播源根），不出现在回执行。base/model 提交空值时输入框保持打开并提示必填；Esc 取消整条链。

## User Stories

1. 作为多宿主用户，我在 TUI 密钥屏选「统一评审 API」、填两个值就能切所有宿主的评审 API，所以不用记命令语法。
2. 作为多宿主用户，我在第三步按 y 就把当前根已存的 Key 一并铺开，所以换 API 商一次操作完成。
3. 作为用户，确认框先告诉我将写入什么再动手，所以批量写根是看得见的。

## Implementation Decisions

- **归属**：全部落在 packages/tui（lists.ts 动作行、app.ts resolveInput 链、types.ts InputOwner 与 AppState.sync 累加器、i18n.ts 键、help.ts 命令对照）。引擎与 CLI 零改动。
- ** AppState.sync**：链式输入的跨步累加器（{base, model}），与 wizard 并列；Esc / 开链时清空。可选字段，测试字面量不破。
- **确认框 danger=false**：sync-api 可逆（重跑旧值即还原），走强调色确认框而非危险红框；与 clear-all 类不可逆操作区分。
- **传播判定**：输入值 trim 后以 y/Y 开头即传播；空或其它值不传播（缺省安全：不覆写其它根的 Key）。

## Testing Decisions

- packages/tui app.spec 新 describe：行 Enter 开链且预设当前根值；两步必填（空提交保持输入 + notice）；y/N 两路 argv；确认执行 / Esc 取消清空 sync。
- i18n zh/en 键同步新增，类型对齐照旧。

## Out of Scope

- `--fallback` 的 TUI 输入（缺省回落 model 已够；要差异化走 `:` 命令）。
- 传播前逐根预览已存 Key 状态（回执已逐根说明）。
