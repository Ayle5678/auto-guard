# 02 — 记忆咨询与信任谓词的唯一所有者

**What to build:** 两处横切不变式获得唯一所有者：(1) consultMemories 收拢「会话 deny → pending deny → 持久 allow」三级优先序为单一函数（今天靠缓存命中函数内的语句位置 + LLM 路复查 + 复合第三 helper 三处手工维持），guardMemory 逃生舱随缝内化；(2) 「不可确定性放行」谓词统一为 bypassesDeterministicTrust(command, {pipes}) 落命令模块，shell 侧保留含管道口径、模板/历史侧保留不含管道口径、审计行拼法维持现状——三口径差异写成已知不一致清单入档（本 spec 显式不裁决）。优先序与各调用点口径逐字节不变。

**Blocked by:** 01（同文件施工序：搬家先行，缩小冲突面）.

**Status:** resolved

- [x] consultMemories 单一函数（session/pending/pipelineLeaves/persistent 分层参数）；pending-deny 优先序语义不变；cacheHit/pendingDenyDecision/pendingDenyForParts 三 helper 合一
- [x] bypassesDeterministicTrust 唯一谓词落 command.ts；shell 路含管道、模板/历史层不含管道；审计行拼法维持现状（行为零变化）
- [x] 已知不一致清单入档（ADR-0021「Known inconsistency: 管道谓词三口径」节）
- [x] 既有断言不动；新增 memory-priority.spec（优先序单点）、bypass-predicate.spec（两口径参数化）
- [x] 三门禁 + conformance 全绿
