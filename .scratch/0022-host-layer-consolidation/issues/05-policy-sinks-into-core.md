# 05 — 宿主策略下沉：translateDecision / resolveNotify / recordToolCallAudit

**What to build:** core 增三个深函数并让三宿主只剩 sink：(1) translateDecision(decision, capabilities) 返回操作/理由/人工否决标记/标题**键名**（文案的家在守卫面目录）；(2) resolveNotify(decision, config, capabilities) 返回通知路由与文本或关闭；(3) recordToolCallAudit(store, …) 落审计记录（source 参数化吸收 user_bash 变体，口令门由调用方前置）。hook 运行时、pi、dsh 的三份翻译/两份通知门/三份审计落库拷贝删除，各自保留真 sink（wire、弹窗、会话注入）。审计 schema 逐字段不变；策略行为逐字节保留（ask 回退差异由 capabilities/config 驱动）。conformance 增三宿主策略等价断言。

**Blocked by:** 02（dsh 同文件区施工序）；软依赖 SPEC 0021 工单 02（标题键已单源；未就位则先带旧键名落地）.

**Status:** resolved

- [x] 三个策略函数落 core（host-policy.ts），只依赖 core 自有类型（能力/审计库/命令分类）
- [x] 三宿主拷贝删除，只留 sink；翻译返回键名非文案（实现注记：resolveNotify 只返回 route——payload 文案是 sink 形状的一部分，dsh context 通知文本与 core notificationText 本就不同，返回文案会改行为；dsh 的 dir-delete-ask 平铺回退由 askStyle='one-shot' 能力驱动保留在 translateDecision 内）
- [x] conformance 三宿主策略等价断言就位（host-policy-equivalence.spec 6 用例：翻译等价 + 一次性宿主回退钉死 + 标题键三宿主同词 + 通知路由等价 + 审计 schema 逐字段）
- [x] 审计记录 schema 逐字段断言不变；三门禁全绿（core/dsh/pi/host-runtime/conformance 全过）
