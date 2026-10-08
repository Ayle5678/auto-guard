# 01 — 审查提示词校准：ask 规则收窄 + 开发循环 allow 倾向

**What to build:** MIMO 主腿与 DeepSeek 备用腿共享的系统提示词（ADR-0024 两通道同一份）中，把 `"ask": uncertain or context-dependent; prefer ask over allow when unsure about destructive effects.` 一行替换为 SPEC 0027 批准文本（ask 仅在 allow 与 deny 都不成立时使用；项目脚本执行/杀 agent 自己起的进程/清理自建临时文件/localhost 探活属典型 allow；多行与 for 循环按整体语义判断；仅是不确定时选 allow 并取更高风险位）。其余行不动。prompt 字节变化使两通道前缀缓存一次性失效（ADR-0020 先例）。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] 替换后按语言拼装的系统提示词 pin（llm-lang 用例）更新为有意快照，双语两份一致
- [x] 既有 core 测试全绿（无行为断言变化；语义变化靠线上 ask 率观测，不在本票断言）
- [x] 提示词其余行逐字节不变（裁决码契约 ADR-0020 部分零触碰）

## Comments

- 回退通道：若线上出现真危险命令被放行，改回这一行即可（单行回退是决策的一部分）。
