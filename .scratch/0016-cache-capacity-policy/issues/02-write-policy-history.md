# 02 — core：历史层停写会话缓存 + 快速路径不写缓存不变量

**What to build:** 缓存只记录规则、学习规则、历史命中之外的结论。历史判断层命中不再写会话缓存（重复命中每次重查本地审计库，毫秒级代价）；静态放行、预授权、学习规则（模板缓存命中）本就不写——一并以测试钉死为不变量，防回归。LLM 兜底 allow 照旧写会话+持久；always-review LLM allow 照旧只写短 TTL 会话缓存；ask 四态选择照旧写会话缓存；持久缓存命中向会话缓存的提升保留（同一 key 刷新，不产生新条目）。

**Blocked by:** None — can start immediately（与 01 无依赖，仅测试文件相邻）

Status: done

Spec 0016。CONTEXT.md「历史判断层」词条的文档面在 04 工单，本票只改行为与测试。

## Scope

- `core/src/guard-service.ts`：`historyDecision` 删除命中后的 `writeSessionCache` 调用（该历史层路径不再有任何缓存写入）。其余写入点一律不动。
- 测试（先例：`guard-service-history.spec.ts`、`guard-service.spec.ts`）：
  - 改写「history hit 写 session cache」既有断言：同一命令第二次裁决仍走 `history` 源（非 `session-cache`），stats.historyHits 累加两次。
  - 不变量：静态放行命中 → 会话/持久缓存 size 不变；user-confirmed 同；模板缓存（learned）命中同。
  - 保持：LLM allow 后会话+持久各一条；always-review LLM allow 只进会话缓存；ask 四态 rememberAsk 进会话缓存；持久命中提升进会话缓存（既有测试已覆盖，确认不回归）。

## Accept

- [ ] 历史层重复命中全部走历史层，会话缓存零写入。
- [ ] 快速路径不写缓存的不变量测试全绿。
- [ ] core 全部既有测试通过（仅历史断言按新语义改写）。
- [ ] typecheck 干净。
