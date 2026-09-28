# 0025 — 直连评审备用端点：主端点失败自动切换 + 备用密钥槽

> Status: resolved
> 决策依据：ADR-0024（直连通道单源）、ADR-0006（key 水合链）、ADR-0026（本 spec 落的决策记录）。

## Problem Statement

上游评审 API 近一周不稳定（9-20 起 DeepSeek 503 连发 + 超时率升到 5%~13%，见 decision-history），单端点配置下 8 秒超时即 fail-closed 拒绝命令。切换 API 商只能整体替换，没有"主端点失败自动走备用端点"的通道；密钥存储每根只有一把 key，无法同时持有两家的凭证。

## Solution

core 直连通道（`directChatReview`，ADR-0024 唯一属主）加一条备用腿：主腿（`apiBase + model`）**任何失败**（超时、HTTP 错误、网络/DNS 错误、响应解析失败）后，若配置了 `fallbackApiBase` 且备用密钥可解析，则用 `fallbackModel` 在备用端点重试一次，独立全新预算；两腿都失败抛聚合错误，fail-closed 语义不变。

- 配置：`fallbackApiBase`（空=禁用，保留现行 400→fallbackModel 同端点阶梯）、`fallbackApiKeyEnv` 进 CONFIG_KEYS；`fallbackModel` 在备用端点启用时语义变为"备用端点上的模型"。
- 密钥：key-store 加备用槽 `api-key-fallback.json`（同加密方案），`hydrateFallbackApiKey` 走 env > 加密存储（无遗留明文层）；`fallbackApiKey` 仅内存水合，不落盘。
- 传输纪律不变：两条腿都走 `httpPostText`（一事一连接，grill-log Round 7 红线）。
- 全宿主一次受益：bootstrap/pi 水合点 + DSH 直连分支接线，7 个宿主零逻辑改动。

## User Stories

1. 作为用户，我把主端点切回 DeepSeek、备用设为 MIMO，主端点 8 秒超时后命令仍能被备用端点审查放行，所以上游抖动不再阻塞我的命令。
2. 作为用户，我用 `set set-fallback-key`（或在 TUI 密钥屏）录入备用密钥、`set set-api fallback-base` 配备用端点，所以两套凭证和端点可以共存管理、随时禁用（fallback-base 留空）。

## Implementation Decisions

- **触发条件 = 任何主腿失败**（用户确认）：不止超时——9-20 一轮拦截里 503 连发与超时同源，宽触发一并覆盖。
- **备用腿独立预算**：`callDirectChat` 每腿自建 AbortController；普通 8s+8s、high 推理 ≤30s+30s，均在 ZCode hook 90s 预算内。OpenCode 宿主受自身 permission 超时约束（ADR-0016 注记）。
- **备用端点配了但备用密钥缺失 → 不盲试**，直接抛主腿错误（避免无谓的 401 腿）。
- **fallbackApiBase 等于 apiBase 视为未配置**（走现行 400 阶梯）。
- **主 400 在备用端点启用时改走备用腿**：同一模型名跨厂商必然也 400，端点级重试优先于模型级重试。
- **`fallbackApiKey` 不进 CONFIG_KEYS**：避免新增明文落盘路径（ADR-0006 方向）。
- CLI：`set set-fallback-key`（TTY 隐藏读，非 TTY exit 2）、`set clear-fallback-key`、`set show-key` 增备用槽两态行（仅备用端点已配置时显示）、`set set-api fallback-base|fallback-model`；TUI 密钥屏同套动作（备用密钥经 Effect 直存，不经 argv）。

## Testing Decisions

- core direct-chat：双 mock server——主超时→备用成功（调用次数、备用 model、备用 Bearer 三断言）、主 5xx→备用成功、主 400→走备用腿、双腿挂→聚合错误、备用 key 缺→不盲试、备用端点=主端点→忽略。
- core llm：DeepSeekReviewer 端到端切腿 + fallback key env>水合优先级。
- key-store：备用槽独立读写清；hydrateFallbackApiKey env>存储、无 env 名跳过 env。
- commands：set-api fallback-base/fallback-model/reset（含空值禁用）。
- TUI app.spec：fallback 动作开输入（preset 来自配置）、密钥校验失败保持输入、合法值发 `saveFallbackKey` Effect、清除走危险确认框。
- 防漂移 pin 更新（有意快照）：guard-messages CANONICAL_KEYS +9、DSH PINNED_DEFAULTS +2、conformance setUsage ×3、TUI set 屏索引。

## Out of Scope

- `sync-api` 传播备用端点字段（多根统一备用端点仍手改 config）。
- `guard ping` 打备用端点（ping 保持主端点语义）。
- 备用腿独立的超时预算字段（沿用 `timeoutMs` 每腿一份）。
