# @auto-guard/conformance

跨宿主一致性套件：同一 guard 场景在六个宿主适配层上必须产生等价裁决（`tests/`，vitest）。

## review-loop — 审查反馈循环回归工具

锁定 grill-log Round 7 的修复：core `httpPostText` 的 one-shot 传输（node:http/https + `agent: false`），在 LLM 裁决后立即 `process.exit()` 的宿主 hook 里零 libuv 断言崩溃。

```bash
pnpm -r build          # 被测进程是宿主 dist 的 hook-cli.js，先构建
pnpm review-loop       # 30× mock（plain http），恒用临时 HOME 隔离
pnpm review-loop -- --https   # 30× mock（自签 TLS + NODE_EXTRA_CA_CERTS）
```

等价直接调用：`node packages/conformance/review-loop.mjs --times 30 [--host zcode|opencode|qoder|claude] [--https] [--live] [--isolate] [--check-isolate] [--clean]`。

统计口径（防缓存污染）：命令全局唯一（时间戳-序号-随机数）；崩溃率分母 = 触网样本（`status.json` 的 `lastDecisionSource === 'llm'` 且非 reviewer 失败）；缓存/静态短路样本不计入分母但显式报告；崩溃判定 = 非零退出 + stderr 含 `Assertion failed`。每次 run 的 stdout/stderr/exit/耗时落盘 temp 目录，报告含 mock server 实收请求数交叉核对。

CI 结论（2026-08-29）：mock 模式可作传输层回归进 CI（http + https 各一轮 `--times N`，秒级/次、零外部依赖）；`--live` 烧真实配额且有网络抖动，永不进 CI。
