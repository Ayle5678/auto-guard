# 宿主策略下沉 core：translateDecision / resolveNotify / recordToolCallAudit

引擎级行为策略以拷贝形式活在三个 adapter 里：recordAudit 三处逐字同构（host-runtime/bootstrap、pi、dsh，仅 source 与口令门微差）——审计记录 schema 由此成为事实上的共享接口却没有所有者；通知路由门 pi/dsh 两处逐字相同（cache 族→notifyCacheHit、llm 族→notifyLlmDecision、rule-allow 升级 page、effectiveNotifyRoute）——core 只出叶子机械件、策略无家；目录删除裁决翻译三处（hook-cli/pi/dsh）：needsReason 重试提示、非 allow 转人工 veto、reviewerFailed 双标题选择，加上 ask 逃生舱能力回退各异。决策：core 增三个深函数——`translateDecision(decision, capabilities)`（返回 action/reason/needsHumanVeto/**vetoTitleKey 键名**而非文案）、`resolveNotify(decision, config, capabilities)`（返回 route/text 或 undefined）、`recordToolCallAudit(store, …)`（source 参数化吸收 user_bash 变体，口令门由调用方前置）；host-runtime / pi / dsh 改调用，各自只剩真 sink（hook wire、pi ui.notify/sendMessage、dsh session inject/append）。审计记录 schema 逐字段不变；翻译与通知策略的现有行为逐字节保留（含各宿主 ask 回退差异——它们由 capabilities/config 驱动，本就坐在 core 类型上）。

## Considered Options

- 放 host-runtime 而非 core：拒绝——pi 与 dsh 不经 host-runtime（进程内形态），放那里等于给第二份拷贝安家；三个函数只依赖 core 自有类型（HostCapabilities、AuditStore、classifyCommand）。
- translateDecision 直接返回文案字符串：拒绝——文案的家在守卫面目录（ADR-0023），策略的家在这里；返回键名让两票互不阻塞、各自演进。
- 连 sink 一起收（宿主零代码）：拒绝——wire 序列化、弹窗、会话注入是真宿主耦合（ADR-0002 的合法居所）；收掉它们等于把宿主适配层做成空壳再从 core 反向漏宿主概念。
- recordToolCallAudit 连口令门/启用门一起吞：拒绝——门是 dsh 特有配置语义，参数化注入比把 dsh 配置概念引进 core 干净。

## Consequences

- 审计记录加字段从三文件改动变一处；通知路由与删除翻译策略可被 conformance 直接钉等价（今天只能逐宿主各自断言）。
- deleteFail 双标题的查词点随 vetoTitleKey 单源化；「宿主只写 sink」成为可检验的结构纪律。
- 第 8 宿主的接入面缩小到：descriptor（hook 形态）或 evaluate+sink（进程内形态），不再抄策略。
- 与 ADR-0023（键的家）、ADR-0024（dsh 翻译拷贝消亡）构成宿主层收拢的三部曲；施工软依赖 0023 先行（键已搬家则查词直接走共享目录）。

## Implementation notes (SPEC 0022)

- `resolveNotify` 只返回 `route`，不返回 text：dsh 的 context 通知文本是宿主协议形状（NoticeMessage + 兜底理由），与 core `notificationText` 本就不同——返回文案会改行为；payload 文案归 sink，路由门归 core。
- 各宿主 ask 回退差异由 `translateDecision(decision, capabilities)` 的能力驱动：one-shot 且 hasUI 的宿主（dsh，ask 由宿主自身审批流处理）对目录删除 LLM-ask 保持平铺 ask（今天的行为），deny 才升级人工否决；其余宿主（含 codex 的 one-shot-无-UI，其 ask 在 wire 层被译为 deny）对非 allow 一律否决——四类宿主行为逐字节保留。
- `recordToolCallAudit` 的 `finalAction` 为可选（吸收 dsh ask 结果不落 final action 的现状）；dsh 的审计口令门由调用方前置（本 ADR 既有决定）。
