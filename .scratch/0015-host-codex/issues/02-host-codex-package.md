# 02 — host-codex 包

Status: done

Spec 0015。镜像 host-zcode 结构（dist 构建，jiti 不用）。

## Scope

- `packages/host-codex`：package.json（workspace 依赖 core + host-runtime）、tsconfig ×2、vitest.config。
- `src/descriptor.ts`：hostId `codex`、`['.codex','auto-guard']`、guardedTools `Bash→bash`、`apply_patch|Edit|Write→edit(patchCommand:'command')`、防御性 pathFields/contentFields、history.bashNames `['bash']`、envNames 空链（身份来自 payload session_id/cwd）、capabilities、无 wire（默认 wire + deny 兜底）。
- `src/codex-capabilities.ts`：askStyle one-shot / headlessFallback deny / hasUI false / 通知双 false / userBash false / sessionState disk。
- 门面 ×6：bootstrap/cli/config/hook-cli/session-start/codex-adapter（运行时 re-export）。
- `tests/runtime-contract.spec.ts`（describeHookHostContract 接入）、`tests/codex-adapter.spec.ts`（Bash 映射、补丁解析多路径、敏感多路径、补丁不可解析 unreviewable、未跟踪工具 passthrough）、`tests/hook-output.spec.ts`（deny JSON 形状、ask→deny 渲染含提示语、allow 静默）、`tests/fail-closed-ladder.spec.ts`（镜像 zcode，codex 断言）。

## Accept

- `pnpm --filter @auto-guard/host-codex test` 全绿；契约套件经 codex 描述符全过。
