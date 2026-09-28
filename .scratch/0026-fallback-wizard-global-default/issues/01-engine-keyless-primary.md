# 01 — 引擎 keyless-primary：无主密钥宿主直走备用腿

**What to build:** `directChatReview` 重构为「主腿仅在 apiKey 非空时尝试；空主密钥 → primaryError = `LLM review missing primary API key`，随后正常进入备用分支」；`DeepSeekReviewer.review` 与 DSH `reviewDirect` 的 missing 检查放宽为「无主密钥且无可用备用（备用端点已配 + 备用 key 已解析）」，否则照旧抛 `missing <apiKeyEnv>`。

**Blocked by:** SPEC 0025 的备用腿（已在 main 工作区）。

**Status:** resolved

- [x] directChatReview 空主密钥跳主腿（零主腿请求）
- [x] Reviewer/DSH 条件放行（usableBackup = 备用端点非空非同址 + fallback key 存在）
- [x] direct-chat.spec 两新场景 + llm.spec Reviewer 级 keyless 场景全绿

## Comments
