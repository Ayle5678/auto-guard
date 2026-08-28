# 08 — host-zcode 适配层

What to build:
- `packages/host-zcode`：`hook-cli.ts`（stdin 1MB 上限、normalize、fail-closed 阶梯、审计/状态/决策历史追加、detached 分析子进程）、`hook-output.ts`（allow 静默、deny/ask JSON、hitDetail）、`zcode-adapter.ts`（Bash/Read/Write/Edit/ApplyPatch 正则映射）。
- `bootstrap.ts` 组合根：磁盘会话态实现（ADR-0004）、key 水合、LightAuditStore（ADR-0005）、askStyle=native（ADR-0007，不接四态）。
- `session-start.ts`（剪枝 + 到点分析，fail-open）。
- 宿主资产：`.zcode-plugin/plugin.json`、`hooks/hooks.json`、`commands/{guard,guard-set,guard-examine}.md`——**修复 guard-set.md 硬编码绝对路径为 `${ZCODE_PLUGIN_ROOT}`**。
- 预构建 dist + vitest；配置根 `~/.zcode/auto-guard/`。

Blocked by: 06
Status: done

Acceptance:
- [x] zcode 版 24 个 spec 中宿主侧部分全绿；core 部分改引 @auto-guard/core
- [x] fail-closed 阶梯（stdin 不可解析/参数不可读/bootstrap 失败→ask；enabled:false→静默）逐级有测试
- [x] allow 决策 stdout 为空串且 exit 0；绝不 exit 2

## Comments

- 2026-08-28: done — hook-cli/hook-output/zcode-adapter/session-start ported on core; bootstrap = disk session state + LightAuditStore + key hydration at ~/.zcode/auto-guard; plugin assets with guard-set.md fixed to ${ZCODE_PLUGIN_ROOT}; fail-closed ladder spec added; 21 tests green
