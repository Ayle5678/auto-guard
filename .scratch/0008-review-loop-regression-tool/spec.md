# 0008 — 审查反馈循环的缓存污染 + live 回归工具转正

## 问题

排查 libuv 崩溃（grill-log Round 7）用的反馈循环脚本（原 `.tmp-ag-test/repro-loop.mjs`，已随清理删除）暴露出一个**统计口径缺陷**：

- ask 决策有 30 分钟持久缓存（`alwaysReviewCacheTtlMinutes`）+ 会话缓存。原脚本命令用 `--variant ${i}`（0..N 循环）且固定格式，跨批次重复 → 大部分样本命中持久缓存，**根本没触网**。
- 后果：崩溃率分母虚高。当时「mock 0/30、live 30/30」的对比里，mock 每批其实只有 ~1 次真实 LLM 调用，其余全是缓存短路（live 首批因 variant 首次出现而 100% 触网，结论方向仍成立，但数字口径不严谨）。
- 修复版脚本已验证正确做法：命令按 `时间戳-i-随机数` 全局唯一 + 每次运行后断言 `status.json` 的 `lastDecisionSource === 'llm'`，只有触网样本计入分母。30× live = 30/30 触网、0 崩溃。

现在脚本已删，**防回归的 live 反馈循环没有留下正式工件**——下次动 LLM/退出/传输层时没有趁手的红灯工具。

## 边界（不要动的）

- `httpPostText` 传输层本身（Round 7 已定稿）；本票只做「工具转正 + 口径修正」。
- live 模式烧真实 API 配额且有网络抖动，**不要**进 CI（研究项 4 的结论预期就是「不进」，票面只需把结论写下来）。

## 研究方向

1. **转正脚本**：落到 `packages/conformance`（或 `scripts/`），命名如 `review-loop.mjs`。保留双模式：默认本地 mock（`node:http`），`--live` 真实 API（key 走 core `loadApiKey` 水合，绝不打印）。命令全局唯一；每 run 断言触网，报告 `crashes/N (llm-path: M)`。
2. **mock 覆盖两条传输分支**：`httpPostText` 按 protocol 选 `node:http`/`node:https`，mock 应同时提供 plain http 与自签 https（`NODE_EXTRA_CA_CERTS`）两种模式，各自 0 崩溃才算绿。
3. **live 副作用隔离**：live 模式目前写真实 HOME 的 status/decision-history/audit。研究 `--isolate`（临时 HOME + key 注入）是否可行——隔离后触网断言读临时 HOME 的 status.json。
4. **CI 取舍结论落档**：mock 模式可进 CI 作为传输层回归（agent:false 行为锁定）；live 明确不进，理由写进脚本头注。
5. **口径文档化**：脚本头注写明「崩溃率分母 = 触网样本」，防止未来再被缓存污染误导。

## Acceptance

- [x] 转正后的 loop 在本机跑 30× mock（含 http 与 https 两种 mock），30/30 触网、0 崩溃、秒级退出判定
- [x] 缓存命中样本不计入崩溃率分母，且被显式报告
- [x] live 模式带 `--isolate`（若研究项 3 结论为可行）；不可行则把原因写进头注
- [x] CI 接入 mock 模式（或记录不接的理由）
- [x] 用法一句话进 `packages/conformance` README 或脚本头注
