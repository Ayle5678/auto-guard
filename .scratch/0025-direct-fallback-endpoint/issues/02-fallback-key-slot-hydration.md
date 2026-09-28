# 02 — 备用密钥槽与水合接线

**What to build:** key-store 抽共用 `saveApiKeyFile/loadApiKeyFile/clearApiKeyFile`，主槽 API 不变；新增 `save/load/hasStored/clearFallbackApiKey` → `api-key-fallback.json`；`hydrateFallbackApiKey(config, loadStored)`：`process.env[config.fallbackApiKeyEnv]`（env 名非空时）> 加密存储，无遗留明文层。接线：`host-runtime/src/bootstrap.ts`（5 个 hook 宿主）与 `host-pi/src/index.ts` 构造 reviewer 前追加水合；`host-dsh/dsh-reviewer.ts` reviewDirect 解析备用 key 传给 directChatReview。

**Blocked by:** 01（签名与字段）。

**Status:** resolved

- [x] key-store 槽位化 + 备用槽四函数
- [x] hydrateFallbackApiKey（env 名空则跳过 env 查询）
- [x] bootstrap/pi 水合点、dsh 直连分支 key 解析
- [x] key-store.spec 备用槽独立性 + 水合三场景；全宿主测试绿

## Comments
