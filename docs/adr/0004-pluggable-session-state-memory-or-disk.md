# 会话状态可插拔：内存实现与磁盘实现并存

一次调用一进程（zcode PreToolUse hook）与长驻进程（dsh 插件、pi 扩展）对"会话内状态"的存续要求相反。core 定义会话态组件接口（session cache、tracker store、pending sinks），提供两实现：**内存实现**（dsh/pi）与**磁盘实现**（zcode 的 session-store/persist-map 提升 core：写透 JSON、TTL 剪枝、>24h 闲置会话目录清理）。宿主 bootstrap 按自己进程模型选择实现；守卫逻辑对存储位置无感知（继承 zcode ADR-0003 "持久化是注入关注点"的结论，但落点从宿主包移到 core）。

## Consequences

- 磁盘实现的 last-write-win 并发语义被接受：最坏是重复 LLM 审查，绝不会错误放行。
- 决策历史（decision-history.jsonl）与状态快照（status.json）属磁盘实现的观测输出，core 提供接口，长驻宿主可选用。
