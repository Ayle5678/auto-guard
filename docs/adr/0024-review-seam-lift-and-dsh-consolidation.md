# 评审 seam 上移与 DSH 收编：directChatReview 单源 + 声明式默认增量 + 分析操作回归 core

LlmReviewer seam 是真的（两 adapter：DeepSeekReviewer、DshLlmReviewer），但放得太低：请求组装、400→fallbackModel 重试梯、超时预算、fail-closed 映射都在 seam 之下被 dsh-reviewer.ts（~150 行）逐段拷贝自 core llm.ts（HttpError、ping、call、消息组装三份），且副本已漂移——dsh 直连 `AbortSignal.any` 无 combineSignals 降级兜底；评审直连路径的任何修复（如 llm.ts 记录在案的 undici/进程退出纪律）必须改两处。同时 host-dsh/config.ts 逐字段拷贝 core 默认值并有五处静默分歧（apiBase 空、timeout 15000、learnedCacheableMinTotal 8、analyzeIntervalMinutes 0 等——部分故意但无标记），三份键清单靠手工镜像；dsh 私有 runLearnedAnalysis 永远全量分析、绕开 core 的窗口+合并语义。决策：core 导出单函数 `directChatReview(tuning, lang, request, apiKey) → ReviewOutcome`——prompt 组装、单发调用、fallback 梯、超时预算、combineSignals 兜底全部内化，成为**直连评审通道**的唯一所有者；DeepSeekReviewer.review 退为薄包装（LlmReviewer 外缝不变，两 adapter 仍坐同一 seam），DshLlmReviewer 只留 ctx.llm 流式路由 + hasDirectEndpoint 分支委托 core。dsh 默认值改声明式增量：`DSH_DEFAULTS = { ...defaultGuardConfig(root), apiBase: '', … }` 逐行注明故意原因，三份键清单从单一 FieldSpec[] 派生。AnalyzeOptions 扩展 `full`（dsh remote「立即分析」传 true，保持今天永远全量的行为）与可选 gate（auditPassword 门），删私有分析与回滚包装。现值与行为零变化。

## Considered Options

- 把 dsh 流式路由（ctx.llm）也搬进 core：拒绝——ctx.llm 是宿主注入件，进 core 违反 ADR-0002；流式路由正是宿主耦合的合法居所。
- directChatReview 吞掉 LlmReviewer 接口、成为唯一评审接口：拒绝——外缝有两个真 adapter（直连/流式），保留接口才能让两通道共享 fallback 语义而各管路由。
- 借机把 dsh 默认值「修正」向 core 看齐：拒绝——改现网行为（如空 apiBase 是 dsh 走注入件的故意设计）；声明式增量让分歧可见而不裁决。
- dsh 分析顺手切回窗口模式：拒绝——改行为；保持 full:true，窗口 vs 全量的取舍留待未来。
- dsh 缺的 combineSignals 兜底不补：拒绝——现代 node 均有 AbortSignal.any，补兜底在正常环境行为不变，纯健壮性对齐，属「不改判断」内允许的修复。

## Consequences

- fail-closed 与超时语义修复一处、两通道同时生效；dsh 副本的漂移风险（已发生一处）类别性消灭。
- 新增 GuardConfig 字段不再需要 dsh 三处手工镜像（CONFIG_KEYS / USER_CONFIG_KEYS / SCHEMA.keys 由 FieldSpec[] 派生）。
- dsh 分析/回滚操作与 core 单源，「永远全量」从隐蔽行为变成一行 full:true。
- 「评审通道」进 CONTEXT 术语表（直连/流式两通道共享 prompt 与裁决码契约）；DeepSeek API 细节的测试面收敛到 core 单处。

## Implementation notes (SPEC 0022)

- `directChatReview(tuning, lang, request, apiKey)` 以 `DirectChatTuning` 四键切片为调参面；`directChatPing` 同步抽出（ping 拷贝一并消亡）；`combineSignals` 导出供 dsh 流式路由补齐降级兜底。
- 分析口令门落地为 `AnalyzeOptions.passwordGate` + `message` 文案槽（可选查词函数，默认 core 目录）——DSH 远端回执逐字节保留经此槽注入，pi/cli 零改动。
