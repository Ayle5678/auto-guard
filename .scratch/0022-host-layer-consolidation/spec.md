# 0022 — 宿主层收拢：DSH 分叉收编、宿主策略下沉、hook 门面瘦身

> Status: resolved（票 01–05 落地；票 06 门面瘦身按本 spec 预留的「可无限期搁置」保持 needs-triage）
> 决策依据：ADR-0024 + ADR-0025；grill-log Round 16 Q6–Q8、Round 17。施工序：DSH 收编 → 策略下沉 → 门面瘦身（门面票可无限期搁置）。

## Problem Statement

宿主层三类结构性风险：(1) DSH 对 core 接口的三处私有分叉——评审直连路径 ~150 行逐段拷贝自 core 评审模块（HttpError、ping、调用、fallback 梯、消息组装），fail-closed 与超时语义存在两份且副本已漂移（缺 AbortSignal 组合的降级兜底）；配置默认值逐字段拷贝且有五处静默分歧（部分故意但无标记）；私有学习分析操作永远全量、绕开 core 的窗口+合并语义。(2) 引擎级策略以拷贝活在三个 adapter——审计落库三处逐字同构（记录 schema 无所有者）、通知路由门两处逐字同、删除裁决翻译三处（含 reviewerFailed 双标题选择）。(3) 五个 hook 宿主各背 ~175 行零行为的门面再导出文件，新宿主按文档指引整包拷贝。付税的是安全语义维护者与下一个宿主作者；用户侧风险是 fail-closed 修复漏改副本。

## Solution

三步收拢：(1) core 导出**直连评审**单函数（prompt 组装、单发调用、fallback 梯、超时预算、信号组合兜底全部内化），DeepSeek 评审器退薄包装、DSH 评审器只留宿主流式路由 + 直连委托；DSH 默认值改声明式增量（逐行注明故意分歧）、三份键清单从单一字段规格派生；DSH 学习分析/回滚回归 core 操作（永远全量显式化为 full 参数）。(2) core 增三个深函数：裁决翻译（返回操作/理由/人工否决标记/标题**键名**）、通知路由、审计落库（source 参数化）；三宿主只剩各自 sink。(3) hook 宿主门面缩为「描述符 + 入口 stub + 真宿主耦合件」，运行时导出绑定好的组合对象，五宿主仪式文件删除或退单行。

## User Stories

1. 作为付费 API 用户，我希望评审直连路径的 fail-closed 修复一处生效，所以超时/退出纪律不会再有漏改副本的窗口。
2. 作为 DSH 用户，我的默认值、评审行为、分析行为逐字节不变（永远全量从隐蔽行为变成显式参数），所以收编对我不可见。
3. 作为 DSH 设置页用户，新增 GuardConfig 字段不再依赖手工三处镜像，所以字段不会静默不持久化。
4. 作为引擎维护者，我希望审计 schema、通知路由、删除翻译有唯一所有者，所以加字段/改策略是一处改动且 conformance 可钉等价。
5. 作为宿主适配层作者，我希望只写真 sink（wire/弹窗/会话注入），所以策略不抄、语义不漂。
6. 作为下一个 hook 宿主作者，我希望接入面 = 一个描述符文件，所以不再拷贝七个文件。
7. 作为审计者，我希望三宿主的策略等价有 conformance 断言，所以「同一裁决三宿主不同行为」会红。
8. 作为已安装用户，我的宿主包入口路径与安装形态零变化（门面瘦身不删包）。

## Implementation Decisions

- **直连评审**：core 单函数（调参切片 + 语言 + 请求 + key → 评审结论）；LlmReviewer 外缝不变（直连/流式两 adapter 仍坐同一 seam）；DSH 流式路由（ctx.llm）留宿主包——宿主注入件不进 core（ADR-0002）。
- **信号组合兜底**：DSH 副本补齐降级兜底（现代 node 均有 AbortSignal.any，正常环境行为不变，纯健壮性对齐）。
- **DSH 默认值**：声明式增量——以 core 默认值为基底、逐行覆盖注释故意原因（空 apiBase = 走注入件、更长超时窗等）；三份键清单（配置键、用户键、设置页 schema）从单一 FieldSpec[] 派生；现值零变化。
- **分析回归**：core 分析选项扩展 full 与可选口令门；DSH remote「立即分析」传 full 保持今天永远全量的行为；私有分析与回滚包装删除。
- **策略下沉**：三函数只依赖 core 自有类型（宿主能力、审计库、命令分类）；裁决翻译返回标题键名而非文案（文案的家在 SPEC 0021 共享目录）；审计记录 schema 逐字段不变；口令门由调用方前置。
- **门面瘦身**：运行时增导出绑定组合对象（或平级 bindHost 帮助器）；五宿主的 bootstrap/config/hook-output/adapter 仪式文件退单行再导出或删除；tests/conformance 的 import 改指绑定帮助器；opencode 的 payload builders 等真宿主耦合件保留；不设新 ADR（ADR-0016「薄门面」的延伸）。

## Testing Decisions

- **评审路径**：既有 llm.spec 的 JSON/裁决码双格式 mock 用例钉解析；直连函数的 fallback 梯、超时、400 重试在 core 单处测试（从 dsh 副本测试收拢）；dsh 流式路由测试保留在宿主包。
- **DSH 配置**：默认值快照断言（逐值与今天相同）钉「零变化」；FieldSpec[] 派生清单的完整性测试。
- **策略等价**：conformance 增三宿主（hook/pi/dsh）翻译与通知路由等价断言；审计落库记录形状逐字段断言。
- **门面**：conformance 与宿主测试改 import 后断言不动；安装器 smoke 证明入口路径不变。
- 三门禁 + conformance 全绿；既有断言只许改 import 与构造调用。

## Out of Scope

- DSH 默认值向 core 看齐、分析切窗口模式——改现网行为，双拒。
- 流式路由进 core（宿主注入件）。
- 管道谓词统一（SPEC 0019 的已知不一致清单）、CLI（SPEC 0020）、文案正典选择（SPEC 0021）。
- 第 8 宿主（门面瘦身的受益者，不是触发条件）。

## Further Notes

- 施工软依赖 SPEC 0021 先行（标题键已搬家则裁决翻译直接查共享目录）；与 SPEC 0019/0020 完全独立。
- 门面票（第三步）标低优先、可无限期搁置——收益依赖下一个 hook 宿主是否到来。
- 漂移证据（2026-09-25 扫描）：dsh 评审副本缺 combineSignals；默认值五处分歧 apiBase/timeout/learned 阈值/分析间隔/provider 字段；recordAudit 三处 :189/:253/:220；通知门 pi/dsh 逐字同；翻译三处 hook-cli :118 / pi :179 / dsh :300。
