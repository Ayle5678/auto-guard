# 02 — 提示词硬切紧凑码 + 测试钉死更新 + mock 服务器跟随

**What to build:** 重写 `packages/core/src/llm.ts` 的 `REVIEW_SYSTEM_PROMPT`：码表指令（A/B/C=allow/deny/ask × 1/2/3=low/medium/high；allow 仅码；deny/ask 码+冒号+一句话理由），删除三键 JSON 指令；en 后缀改为 `Write the deny/ask reason in English.`，同步更新函数文档注释（引用 ADR-0020，替换 ADR-0011 字节稳定表述）。更新被钉死的断言：`llm-lang.spec`（`'strict JSON'`→`'verdict code'`、en 措辞）、`conformance.spec:288`（同前）。`llm.spec` 补紧凑码响应用例（裸码、码+理由、fence 码；既有 JSON mock 用例保留作回退分支覆盖）。`review-loop-mock-server.mjs` 固定响应改为 `A1`。dsh-reviewer 共享件零改动，验证其既有测试全绿。

**Blocked by:** 01 — 解析器必须先能吃下紧凑码，提示词才能要求它。

**Status:** done

- [x] zh/en 两套系统提示词含码表九码与「allow 仅码 / deny/ask 码+理由」规则，无 JSON 字样
- [x] en = zh 基底 + 固定英文理由指令后缀（前缀稳定性断言保留）
- [x] llm.spec 新增用例：`A1` 裸码、`B2: reason`、fence 包裹码均正确解析为 LlmReviewResult
- [x] 既有 JSON mock 用例全部通过（回退分支）
- [x] conformance mock 服务器返回 `A1`，review-loop mock 模式端到端全绿
- [x] 全仓 typecheck + test 全绿（含 dsh 包）

## Comments

- 2026-09-21: 建票 —— SPEC 0018 / ADR-0020；prompt 前缀一次性失效已接受。
- 2026-09-21: done。typecheck 全过；测试 11 包绿（core 397/397 含 dsh 全绿），host-pi 15/16 的唯一失败为既有边缘慢测试 `session-ui-lang.spec`（~2s/5s 预算，负载下超时；stash 基线复跑同样失败、单跑稳定通过——与本次改动无关）。review-loop `--host zcode --times 5` mock 模式 GREEN：mock 回 `A1`，5/5 触网解析成功，avg 2124ms。
