# 02 — DSH 评审器收编：流式保留 + 直连委托 + 兜底补齐

**What to build:** DSH 评审器瘦身：只留 ctx.llm 流式路由 + 直连端点分支委托 core 直连评审函数；逐段拷贝（HttpError、ping、调用、重试梯、消息组装三份）删除；副本缺失的信号组合降级兜底补齐（现代 node 均有 AbortSignal.any，正常环境行为不变，纯健壮性对齐）。fail-closed 与超时语义自此单源。流式路由测试留宿主包，直连路径测试已在 core（工单 01）。

**Blocked by:** 01（core 直连函数就位）.

**Status:** resolved

- [x] DSH 评审器只含流式路由与委托分支；拷贝块全删（HttpError/ping/callDirect 及直连重试梯与消息组装）
- [x] 信号组合降级兜底补齐（流式与直连两路都走 core combineSignals）
- [x] dsh 流式评审行为不变（既有 dsh 测试 33/33 绿）
- [ ] 三门禁 + conformance 全绿（随 spec 收尾统一跑）
