# 09 — host-dsh 适配层

What to build:
- `packages/host-dsh`：入口 `index.ts`（`tools/pre-execute` 监听 + `ctx.tools.guard` 单调守卫 + 权限预设 activeFor 启停 + 通知路由执行 + 审计写入 + 会话事件）、`adapter.ts`（ToolExecution → GuardRequest）、`cordis.patch.yml`（auto-guard 预设注入）。
- 设置：`config.ts` 挂 settings namespace（secret role 字段打码）+ 旧 config.json 迁移/回退；key secret role 挂进水合链。
- LLM：注入包 `ctx.llm` 路由的 reviewer 实现（provider/model/reasoningEffort/fallback），保留直连回退路径。
- 浏览器半区：`client.js` 设置页（分组表单、维护按钮、学习规则弹窗、统计区）+ `typert.ts` remote manifest，全部改调 core 操作层（ADR-0009）。
- 无 slash 命令（维持 dsh ADR-0014）；配置根 `~/.dsh/auto-guard/`；审计走 SqlcipherAuditStore。

Blocked by: 06
Status: done

Acceptance:
- [x] dsh 版 19 个 spec 中宿主侧部分全绿
- [x] pre-execute 决策映射（deny/ask/next+命令回写）与 headless 原生 ask→deny 语义有测试
- [x] client.js 经 Typert 调用 status/analyzeNow/listRules/rollback/clear/export/stats 全部走通（mock remote）

## Comments

- 2026-08-28: done — pre-execute entry + monotonic guard + preset gating + notify channels + SqlcipherAuditStore; settings namespace via SDK-free schema shim (register consumes shape); DshLlmReviewer on core reviewer primitives; typert/client.js ported (zod public dep); SDK typed via ambient declarations; 26 tests green
