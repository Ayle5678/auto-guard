# 0018 — 紧凑裁决码：LLM 裁决输出从三键 JSON 换为 A1–C3 短码

> Status: ready-for-agent
> 决策依据：ADR-0020；修订 ADR-0011 的「zh prompt 字节稳定」前提。调研结论：allow 路径的 LLM reason 全下游只写不读。

## Problem Statement

现行评审契约要求模型输出三键严格 JSON：`{"decision":"allow|deny|ask","risk":"low|medium|high","reason":"one sentence"}`。逐条核查 reason 的全部消费点后发现：

- **allow 的 reason 是只写不读的**。它落进审计库 reason 列（`summarizeSince` 只按 kind/source 分组，学习规则合成不读 `row.reason`）、session/persistent/template 三层缓存条目（命中后组装出的仍是 allow 决策，而所有宿主对 allow 静默、`lastDetail` 写死 passthrough 文案）——没有任何界面或后续分析读它。
- **deny/ask 的 reason 是核心载荷**：hook 出线 `permissionDecisionReason`、opencode reject 附言、pi/dsh 弹窗、`guard status/recent` 的 lastDetail 全依赖它（grill-log：可控面只有 reason 文本）。
- **risk 不可省**：`risk !== 'high'` 是所有缓存写入的门槛（guard-service 三处 writeSessionCache/writePersistentCache 及模板缓存）；丢 risk 会把高危 allow 错误地缓存为 medium，是安全行为退化。

代价：每次缓存未命中的 LLM 审查都要生成约 30–50 个输出 token（JSON 骨架 15–20 + 理由句 10–25），而绝大多数裁决是 allow。输出 token 是计费大头，且生成延迟与输出 token 数近似线性——每个 allow 审查平白多花约 1–2 秒。

## Solution

把评审输出契约换成**紧凑裁决码**：字母编码决策（A=allow / B=deny / C=ask）× 数字编码风险（1=low / 2=medium / 3=high）：

- **allow**：只输出码本身，如 `A1`（约 1–2 token）。
- **deny / ask**：输出 `码: 一句话理由`，如 `B3: rm -rf 会递归删除项目目录`（理由通道原样保留）。

切换方式为**硬切 prompt + 双格式解析**：系统提示词只教新格式；`parseReviewJson` 先试紧凑码、不匹配再回退旧 JSON——模型不服从时最坏退回今天的解析路径与成本，不新增配置键。`fromLlm` 的 `reason || 'Reviewed by LLM'` 兜底已存在，allow 无理由路径天然兼容。

## User Stories

1. 作为付费 API 用户，我希望 allow 裁决只花一两个输出 token，所以每次缓存未命中的审查成本降到最低。
2. 作为交互中的 agent 用户，我希望 LLM 审查更快返回，所以命令审查延迟不再被理由句生成时间拖长。
3. 作为被守卫的 agent，我收到的 deny/ask 理由与今天完全一样，所以被拒后按理由调整方案的能力不受影响。
4. 作为运维者，我希望模型不服从新格式时守卫仍能解析旧 JSON，所以格式切换没有服从率悬崖、无需回滚开关。
5. 作为关注审计的用户，我希望 allow 行为变化只体现在审计 reason 列的兜底文案（'Reviewed by LLM'），所以既有报表与分析零影响。
6. 作为 DSH 用户，我的流式评审（dsh-reviewer）自动获得同一契约，因为 prompt 与解析器都是 core 共享件。

## Implementation Decisions

- **码表**：`A1 A2 A3`=allow（low/medium/high）、`B1 B2 B3`=deny、`C1 C2 C3`=ask；deny/ask 码后接英文冒号（容忍中文全角冒号）+ 一句话理由（中文或英文，en 配置下英文，ADR-0011 语义保留）。
- **解析顺序**：紧凑码优先，旧三键 JSON 回退；紧凑码分支大小写不敏感、容忍 code fence 包裹与空白；码后理由可缺省（缺省 reason=''，走 `fromLlm` 既有兜底）。两条分支都无法解析时维持现状抛错 → fail-closed。
- **改动面**：`core/llm.ts`（REVIEW_SYSTEM_PROMPT 重写 + en 语言后缀措辞）与 `core/review-parse.ts`（双格式）两处；dsh-reviewer 复用共享件自动跟随，零改动。函数名 `parseReviewJson` 不改（7 个调用点无谓翻动），文档注释更新。
- **prompt 缓存**：系统提示词字节变更使 DeepSeek prompt-cache 前缀一次性失效，之后重新稳定——放弃 ADR-0011 的「zh 基底字节不变」约束（该约束的收益是保缓存前缀，一次性失效可接受，ADR-0020 记录）。
- **下游零改动**：Decision/LlmReviewResult 结构、缓存条目、审计 schema、宿主出线协议全部不动。

## Testing Decisions

- **core 单测**（guard-service.spec 既有 parseReviewJson 块 + llm.spec 补用例）：裸码、码+理由、全角冒号、fence 包裹、大小写、`D4` 类非法码返回 undefined；既有 JSON 用例原样保留，正好钉死回退分支。
- **prompt 钉死**：llm-lang.spec 与 conformance.spec 的 prompt 包含断言从 `'strict JSON'` 换为新契约关键词（`'verdict code'`）；en 后缀断言换新措辞。
- **review-loop mock**：mock 服务器固定响应从旧 JSON 换为 `A1`，端到端走新解析路径；旧 JSON 回退路径由 llm.spec 的既有 JSON mock 用例覆盖。
- **实机服从率**（工单 03）：reviewer 直连真实 API 抽测 20 次（混合 allow 与指向临时目录的删除类命令），统计紧凑码 / JSON 回退 / 解析失败三档比例——危险命令样本一律以**临时测试目录**为目标路径，仅作为评审文本，从不执行。

## Out of Scope

- `max_tokens` 上限收紧——收益微小且可能截断 deny 理由，不做。
- 配置开关（verdictFormat: compact|json）——双格式解析已提供等价回滚安全，拒绝新增配置面。
- 缓存/审计中 allow 兜底文案 'Reviewed by LLM' 的美化——无消费方，不做。
- reasoning 模型的 reasoning token 治理——与本契约正交。

## Further Notes

- 调研快照（2026-09-21）：`hook-cli.ts:351` allow 的 lastDetail 写死 passthrough 文案；`learned-rules.ts:209` 学习规则理由从统计合成；`summarizeSince` 按 kind/source/reviewer_failed 分组——三者共同构成「allow reason 只写不读」的证据链。
- en 语言指令措辞从 `Write "reason" in English.` 改为 `Write the deny/ask reason in English.`——allow 已无 reason 字段。
