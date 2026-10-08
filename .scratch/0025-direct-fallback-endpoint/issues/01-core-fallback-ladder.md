# 01 — core 备用腿阶梯：directChatReview 端点级重试 + 配置字段

**What to build:** `DirectChatTuning` 增 `fallbackApiBase?`；`directChatReview(tuning, lang, request, apiKey, fallbackApiKey?)` 在主腿任何失败后、备用端点已配置且备用 key 存在时，用 `{...tuning, apiBase: fallbackApiBase}` + `fallbackModel` 重试一次，失败抛 `LLM review failed (primary: …; fallback: …)`；无备用端点时保留 400→fallbackModel 阶梯；备用端点=主端点视为未配置。`GuardConfig` 增 `fallbackApiBase`/`fallbackApiKeyEnv`（默认 ''，进 CONFIG_KEYS）与 `fallbackApiKey`（仅内存）；`DeepSeekReviewer.review` 解析 `env[fallbackApiKeyEnv] || config.fallbackApiKey` 传入。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] types/config 字段与默认值（空=禁用，旧行为不变）
- [x] directChatReview 备用腿 + 聚合错误 + errorText 辅助
- [x] DeepSeekReviewer 备用 key 解析与传递（ping 保持主端点）
- [x] direct-chat.spec 双 mock 六场景全绿；既有用例零改动通过

## Comments

- 2026-09-28 400 的归属变化：备用端点启用时主 400 改走备用腿（同模型名跨厂商也 400，端点级优先于模型级）。
