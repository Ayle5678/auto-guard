# 04 — core：LLM reviewer + key 水合链

What to build:
- `llm.ts`：`LlmReviewer` 接口 + `DeepSeekReviewer`（直连 OpenAI 兼容 chat/completions，固定 system prompt、temperature 0、命令置尾最大化 prompt-cache、超时 fail-closed、fallback 模型、`ping()`）。timeoutMs 默认 **8000**。dsh 适配层将注入包 ctx.llm 路由的实现，接口兼容。
- `review-parse.ts`：严格 JSON 容错解析（risk 缺省 medium）。
- key 管理统一（ADR-0006）：zcode `key-store.ts`（AES-256-GCM 机器绑定）+ `hydrateApiKey(config)`（env > 加密存储 > 遗留明文，只读不回写）进 core。
- `secret.ts`、`analyze-state.ts`。

Blocked by: 02
Status: done

Acceptance:
- [x] zcode key-store/水合 spec 迁入并通过
- [x] 水合链三层优先级有逐层覆盖测试；遗留明文字段任何写路径都不可达
- [x] dsh 侧注入 mock reviewer 后 decide() 全链路不需要真实网络

## Comments

- 2026-08-28: done — hydrateApiKey(config, loadStored) in core key-store; three-tier priority + no-writeback tested; dsh provider-route error stays in host-dsh
