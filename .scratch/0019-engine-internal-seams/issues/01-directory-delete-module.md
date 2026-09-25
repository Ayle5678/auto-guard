# 01 — 删除复核协议独立成模块（纯搬家）

**What to build:** 目录删除复核的全部知识（重试状态机、删除标记文本协议、Remove-Item 与宿主事件解析）从裁决管线文件整体搬入独立的 core 模块，管线文件缩到 ~820 行纯管线；session key 的构造与拆解成对归属缓存模块（今天分持两处）。既有导出经公共 barrel 原路径 re-export，全部调用方零改动。行为零变化：这是本 spec 的铺垫票——先搬家缩小体积，段裁决内缝的 diff 才可审。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 新模块 surface：matchPending / pruneExpiredPendingDeletes / removeItemTargetTypeOf / targetsOf + 标记协议既有导出（barrel 原路径 re-export，调用方零改动）
- [x] session key 构造与拆解同主于缓存模块（splitSessionKey 落 cache.ts），删除复核侧只消费
- [x] 宿主事件格式解析随行搬入（extractDeletionReason + messageText，删除理由数据源）
- [x] 既有测试断言一条不改（只改了 guard-service.spec 的 import）；删除复核测试断言原样
- [x] typecheck / test / smoke 三门禁 + conformance 全绿
