# 直连通道备用端点：主腿失败自动切备用腿 + 双密钥槽

上游评审 API 会整周不稳定（2026-09-20 起 DeepSeek 503 连发、超时率从 <1% 升至 13%），而直连通道（ADR-0024）只有单端点单密钥：`timeoutMs` 预算一烧完就 fail-closed，换 API 商等于整体替换。决策：`directChatReview` 在主腿（`apiBase + model`）**任何失败**（超时、HTTP 错误、网络/DNS 错误、解析失败）后，若 `fallbackApiBase` 已配置且备用密钥可解析，则用 `fallbackModel` 在备用端点重试**一次**，每腿独立预算（`reviewTimeoutBudget` 各调一次）；两腿都失败抛聚合错误 `LLM review failed (primary: …; fallback: …)`，fail-closed 语义不变。密钥面：key-store 槽位化，备用槽 `api-key-fallback.json` 同加密方案；水合链 `fallbackApiKeyEnv` 环境变量 > 备用槽加密存储（无遗留明文层——备用槽没有历史）；`fallbackApiKey` 只在内存，不进 CONFIG_KEYS，不新增明文落盘路径。传输纪律沿 `httpPostText` 一事一连接（grill-log Round 7），两腿都不许碰池化 fetch。

## Considered Options

- 只在超时触发备用腿：拒绝——9-20 一轮拦截里 503 连发与超时同源，任何失败都切才能整类覆盖（用户确认）。
- 备用腿给独立超时预算字段：拒绝——每腿沿用 `timeoutMs`，8s+8s 与 high 的 30s+30s 都在 hook 宿主 90s 预算内，字段是多余旋钮。
- 备用端点配了但密钥缺失时盲试：拒绝——必然 401，直接抛主腿错误更诚实。
- `sync-api` 一并传播备用端点：拒绝（本 spec out of scope）——多根统一备用端点仍手改 config，等真实需求再议。
- 复用 `fallbackProvider` 字段：拒绝——那是 DSH ctx.llm 路由名（ADR-0007 语义），直连端点有自己的字段族。

## Consequences

- `fallbackApiBase` 空串（默认）= 完全现行行为（含 400→fallbackModel 同端点阶梯）；配置后 `fallbackModel` 语义变为「备用端点上的模型」，主 400 改走备用腿（同模型名跨厂商也 400，端点级重试优先于模型级）。
- 一次改动全宿主受益：bootstrap/pi 水合点与 DSH 直连分支接线后，7 宿主共享备用腿；每条被拦命令的最坏等待从「8s 超时即拒」变为「主腿预算 + 备腿预算后仍拒」，换来上游抖动期命令不再被 fail-closed 卡死。
- OpenCode 宿主（常驻插件 spawn hook-cli）总时长受其自身 permission 超时约束，备用腿放大了最坏等待——文档注记，不为其单列预算。
- 双密钥槽进入 key-store 契约：主槽文件名与 API 不变，旧根零迁移。

## Update (2026-09-28, SPEC 0026)

备用端点从"每根一份的可选保险"升格为**机器级全局资源**：TUI 备用向导一次写入所有已装且已播种的宿主根（配置 + 加密备用槽）；引擎侧空主密钥 = 跳过主腿直走备用腿（不再先抛 `missing key`），"没配自己 API 的宿主默认用备用 API"由此成立——新根默认 apiBase 非空但无密钥，密钥缺失即事实上的未配置，主密钥在而端点错的情形仍由 any-failure 阶梯兜住。
