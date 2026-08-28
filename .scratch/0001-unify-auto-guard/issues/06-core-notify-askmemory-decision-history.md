# 06 — core：通知策略 + ask 四态 + 决策历史 + 命令操作层

What to build:
- 通知：dsh 的 `notify-policy.ts`/`notify-text.ts` 纯函数（page/context/off 路由、来源中文标签、规则放行强制 page）+ pi/zcode 的 `notify.ts` 文案函数合并为一套（超集标签）。
- `ask-memory.ts`：四态纯逻辑（canRememberAsk / resolveAskMemory / ASK_MEMORY_OPTIONS），是否启用由宿主能力声明决定（ADR-0007）。
- 决策历史（zcode HEAD）：环形 JSONL（200 行）、hitDetail 生成、读时截断。
- **命令操作层**：guard on/off/status/stats/ping、set set-key/show-key/clear-key/set-api/history/reload、examine on/off/status/clear、optimize status/analyze/auto/list/rollback 的宿主无关函数（ADR-0009 的 core 半区；dsh Typert 与 pi/zcode 命令面共用）。
- HostCapabilities 类型定义 + core 内所有能力分支消费点。

Blocked by: 04, 05
Status: ready-for-agent

Acceptance:
- [ ] 路由/文案为纯函数，零 IO，快照测试三宿主默认配置下的输出
- [ ] 操作层函数被 fake deps 驱动时无需任何宿主 SDK
- [ ] core 全包 grep 无 `@deepseek-ai|@earendil-works|zcode` 引用
