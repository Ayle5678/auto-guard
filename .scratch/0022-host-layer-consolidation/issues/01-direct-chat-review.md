# 01 — core 直连评审单函数：directChatReview

**What to build:** core 导出直连评审单函数（调参切片或实施时已就位的配置类型 + 语言 + 请求 + key → 评审结论）：prompt 组装、单发调用、400→fallback 重试梯、超时预算、信号组合降级兜底全部内化，成为直连评审通道的唯一所有者。DeepSeek 评审器退为薄包装——LlmReviewer 外缝不变（直连/流式两 adapter 仍坐同一 seam）。fallback 梯、超时、重试的测试从宿主副本收拢到 core 单处。评审行为逐字节不变（既有 llm.spec 双格式 mock 用例钉死）。

**Blocked by:** None — can start immediately（与 SPEC 0019 可并行；签名以实施时已就位的配置类型为准）.

**Status:** resolved

- [x] directChatReview 单函数导出；组装/梯/预算/兜底内化
- [x] DeepSeekReviewer 退薄包装；LlmReviewer 接口不变
- [x] fallback/超时/重试测试收拢 core 单处；既有 llm.spec 断言不动（dsh 副本本无直连测试；core llm.spec 经薄包装全绿 + 新 direct-chat.spec 钉 seam）
- [x] prompt 逐字节 pin 维持；三门禁全绿
