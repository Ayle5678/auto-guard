# 紧凑裁决码：LLM 评审输出契约从三键 JSON 换为 A1–C3 短码，双格式解析回退

LLM 评审的系统提示词改为要求**裁决码**输出：字母编码决策（A=allow / B=deny / C=ask）× 数字编码风险（1=low / 2=medium / 3=high）；allow 只回码本身（如 `A1`），deny/ask 回 `码: 一句话理由`（如 `B3: …`）。解析器（`parseReviewJson`）先试紧凑码、不匹配回退历史三键 JSON——模型不服从时最坏退回旧解析路径，无需配置开关。动机：allow 的 reason 经核查全下游只写不读（审计列、三层缓存条目、lastDetail 均不消费），却让每次缓存未命中的审查多生成约 30–50 个输出 token；deny/ask 的 reason 与 risk（缓存写入门槛）是真实载荷，全部保留。本 ADR 同时修订 ADR-0011 的「zh 基底 prompt 字节稳定」前提：提示词字节变更使 DeepSeek prompt-cache 前缀一次性失效，接受。

## Considered Options

- 保留 JSON、仅对 allow 省略 reason：拒绝——省得不够（JSON 骨架 15–20 token 仍在），且两种响应形状按裁决分支二选一不如统一码表直白。
- 单字符 1–9 码表：拒绝——严格 1 token 但码表语义全靠提示词约定，日志与调试不可读；字母+数字约 2 token，差额可忽略。
- 配置开关切换新旧格式：拒绝——双格式解析已提供等价回滚安全（旧响应永远可解析），多一个配置键与两条 prompt 维护路径违背显式性。
- 顺带砍 risk 字段：拒绝——`risk !== 'high'` 是全部缓存写入门槛，丢 risk 会把高危 allow 错误缓存，安全行为退化。

## Consequences

- 每次缓存未命中的 allow 审查输出从约 30–50 token 降到 1–2 token，审查延迟相应缩短。
- 审计库与缓存中 allow 行的 reason 变为兜底文案 `Reviewed by LLM`（`fromLlm` 既有路径）——无任何读方，零影响。
- deny/ask 的理由语言跟随语言设置的语义保留（ADR-0011），en 指令措辞改为 `Write the deny/ask reason in English.`
- 提示词字节变更后 DeepSeek prompt-cache 前缀一次性重建；之后新提示词恢复稳定前缀。
- 模型返回旧 JSON 属预期内回退而非错误；仅当紧凑码与 JSON 都无法解析时才抛错走 fail-closed（与现状一致）。
- dsh 流式评审共享同一 prompt 与解析器，自动获得新契约；函数名 `parseReviewJson` 维持不变（职责仍是「解析评审回复」，避免 7 个调用点无谓翻动）。
