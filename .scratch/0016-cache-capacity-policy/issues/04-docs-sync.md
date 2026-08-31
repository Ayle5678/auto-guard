# 04 — 文档同步：CONTEXT.md 词条 + README 双语配置表

**What to build:** 文档与 1100 容量、新写入策略一致：术语表不再声称历史层「只写会话缓存」；双语 README 配置表反映 `sessionCacheSize` 新默认值 100 并新增 `persistentCacheSize`（1000）行；缓存相关叙述（若提及写入条件）与「只记录规则、学习规则、历史命中之外」对齐。

**Blocked by:** 01 — core-cache-capacity；02 — write-policy-history（文档描述的是最终行为与数值）

Status: done

Spec 0016。文档纪律先例：SPEC 0010/0014 的双语矩阵同步。

## Scope

- `CONTEXT.md`：「历史判断层」词条「只写会话缓存」→「不写任何缓存」；「持久缓存」词条补容量上限与 LRU 逐出语义（含命中刷新、完全相同命令合并为单条）；「会话缓存」词条补默认 100。
- `README.zh-CN.md` / `README.md`：配置表 `sessionCacheSize` 默认值 256 → 100；新增 `persistentCacheSize` 行（1000，跨会话持久缓存容量）；正文若有缓存容量/写入条件的描述一并核对（含 TTL 行的相邻表述）。

## Accept

- [ ] 双语配置表数值一致且与实现默认值一致。
- [ ] 术语表三词条与行为一致，_Avoid_ 行保留。
- [ ] README 中英两份对同一键的描述无分叉。
