# 01 — host-runtime：补丁提取 + deny 兜底 + cwd 兜底 + 契约参数化

Status: done

Spec 0015。ADR-0016 纪律：描述符保持纯数据，行为全部落运行时。

## Scope

- `core/types.ts`：`GuardRequest` 增可选 `paths?: readonly string[]`（多目标文件写，apply_patch 用）。
- `core/guard-service.ts`：`decideFile` 对 `filePath` + `paths` 全部路径过敏感路径门（命中即 ask，理由带首个命中路径）；其余行为不变（文件工具本就不读内容）。
- `host-runtime/descriptor.ts`：`ToolMapping` 增 `patchCommand?: string`（纯数据：tool_input 中承载 V4A 补丁文本的字段名）。
- `host-runtime/extraction.ts`：`parsePatchPaths()`（`*** Add/Update/Delete File:` + `*** Move to:` 头部，trim + 去重保序）；`toGuardRequest` 在 synthesizeCommand 后、bash 前分流：补丁文本缺失或解析零路径 → unreviewable；GuardRequest `{ tool: mapping.guardTool, filePath: 首, paths: 全部 }`。
- `host-runtime/bootstrap.ts`：`workspaceFromEnv(fallback?: string)` —— env 链 → fallback（payload cwd）→ process.cwd()。
- `host-runtime/hook-cli.ts`：workspace 调用传 `input.cwd`；`historySubject` 对 patchCommand 工具取首个补丁路径作 subject；wire.serialize 两处调用传 lang。
- `host-runtime/wire.ts` + `create-hook-host.ts`：默认 wire 工厂化，`capabilities.headlessFallback === 'deny'` 时 ask → deny（reason 后拼 catalog 新键 `askDeniedNoPrompt`，跟随 lang）；`defaultWire` 裸导出保持旧行为（ask 照发，zcode 等不受影响）。
- `host-runtime/messages.ts`：新键 `askDeniedNoPrompt`（zh/en）。
- `host-runtime/tests/hook-host-contract.ts`：fail-closed ladder 的 ask 断言按 `descriptor.capabilities.headlessFallback` 参数化（'deny' → 断言 deny 渲染）。
- core 既有测试补一条 decideFile 多路径用例。

## Accept

- 全部既有测试不动语义通过（zcode/claude/qoder/opencode 契约 + ladder）。
- typecheck 干净。
