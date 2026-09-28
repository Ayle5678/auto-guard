# 0026 — 备用端点完整向导（全局传播）+ 无主 API 宿主默认走备用

> Status: resolved
> 决策依据：SPEC 0025（备用端点机制）、ADR-0026（备用端点契约，本 spec 追加更新注记）、ADR-0014（TUI 动作即 runCli/Effect）、SPEC 0023（sync-api 的根遍历规则）。

## Problem Statement

SPEC 0025 的备用密钥入口是单步 key 输入，备用端点 base/model 要另跑 `set set-api fallback-*`，且只写当前根。用户需要：①一个完整的三步备用向导（地址 → 模型 → 密钥）；②备用端点是**机器级全局资源**，一次配置写入所有宿主根；③没配自己 API（无主密钥）的宿主直接用备用 API 评审，而不是 `missing API key` 直接 fail-closed。

## Solution

1. **引擎（keyless-primary）**：`directChatReview` 收到空主密钥时跳过主腿、直接走备用腿（每腿预算不变）；`DeepSeekReviewer.review` / DSH `reviewDirect` 只在「无主密钥且无可用备用」时才抛 `missing <env>`。
2. **TUI 备用向导**：`WizardState`/`WizardInput` 加 `slot: 'primary' | 'fallback'`；密钥屏「设置备用密钥」动作开三步向导（预设取当前根 fallbackApiBase/fallbackModel，模型步预设来自配置、Enter 保留），复核行明示「写入全部宿主根」。
3. **全局保存**：`saveFallbackWizard` 按 sync-api 同款根规则（宿主已装 + 配置根已播种）遍历所有根：提交了 base/model 就写 `fallbackApiBase`/`fallbackModel`（空=不动各根现值），备用密钥一律写入各根加密备用槽；回执逐根列明。单步 `fallback-key` 输入路径删除（Effect/owner/i18n 同步清理），CLI `set set-fallback-key` 保留为终端单步等价物。

## User Stories

1. 作为多宿主用户，我在 TUI 备用向导里填一次地址/模型/密钥，所有宿主根都具备同一套备用 API，所以每个宿主在主 API 故障时都能切到备用。
2. 作为某宿主的新用户（从未配过自己的 API key），我的命令审查直接走备用 API，所以开箱即可用而不是每条命令 fail-closed。

## Implementation Decisions

- **空主密钥 = 跳过主腿而非 401 试探**：直接不发主腿请求，省一次必败调用；`LLM review missing primary API key` 成为聚合错误里的主腿文案。
- **"没设 API" 判定为「主密钥不可解析」**：新根默认 apiBase 非空但无密钥，密钥缺失即事实上的"未配置"；主密钥在但端点错仍会被 any-failure 阶梯兜住。
- **备用向导 base/model 空 = 不动各根现值**（与主向导"Enter 保留"一致语义）；key 必填（向导校验 ≥8 无空白），永远传播。
- **全局写入不经 argv**：向导收集后 Effect 直调 `saveFallbackWizard`（core 操作层），密钥不落命令行（ADR-0014 决策 3 同款纪律）。

## Testing Decisions

- core direct-chat：空主密钥 + 备用 → 只打备用 server（次数/model/Bearer 断言）；空主密钥 + 无备用 → `LLM review missing primary API key` 且零请求。
- core llm：Reviewer 无主密钥 + 备用端点 + 水合备用 key → 备用成功、lastReview ok。
- TUI app.spec：备用向导三步链 + 复核 + slot 传递的 wizard Effect；短密钥复核报 `wizInvalidKey` 且不发 Effect。
- TUI actions.spec：`saveFallbackWizard` 双根写入（配置+备用槽、主端点不动）、未播种/未安装根跳过、空 base/model 保留各根现值。

## Out of Scope

- CLI 侧的全局备用向导（终端用户用 `set set-api fallback-*` + `set set-fallback-key` 组合可达）。
- 备用端点按宿主差异化（全局一套，按根覆写仍可手改 config）。
