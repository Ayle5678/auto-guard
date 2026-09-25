# 0019 — core 引擎内聚：段裁决内缝、引擎调参切片、删除复核独立模块

> Status: implemented (SPEC 0019 完成于本次提交；四门禁全绿)
> 决策依据：ADR-0021；grill-log Round 15。根约束：纯结构重构，裁决行为零变化。

## Problem Statement

裁决引擎的心脏（GuardService 所在文件，1260 行）外深内浅：对外 interface 已足够小，但「评估一条简单命令」这一域内概念在三个 decide 循环里手工同步——缓存回写三连 if 三处逐字拷贝、「不可确定性放行」谓词四种拼法、pending-deny 三个 helper 分持，改一处缓存策略必须同步三处且拷贝已在漂移。同时：GuardConfig 47 键超集穿透引擎构造接口（实际消费 ~10 键），45 行 makeConfig 模板在 9 个 spec 文件逐字重复，每加一个配置键要改 9 个测试文件；目录删除复核协议 ~440 行（重试状态机、删除标记文本协议、Remove-Item/事件解析）混居在管线文件尾部；session key 语法（构造与拆解）分持在两个模块。对 agent 终端用户无直接影响——这是一份行为零变化的结构 spec，受益者是维护者与未来的功能作者。

## Solution

三步施工（顺序固定）：先把目录删除复核协议整体搬入独立模块（纯移动，管线文件缩到 ~820 行）；再在管线内部抽**段裁决内缝**——私有 decideSegment 独占「分类→记忆→缓存→LLM→回写」全部实现，三个 decide 退为薄组合策略，pending-deny 优先序与 stats 记录各获唯一所有者；最后把引擎构造接口收窄为**引擎调参切片**（GuardTuning，~10 键），全量配置留宿主层。拷贝间已漂移的语义点（管道谓词三口径）显式参数化保留，不做任何统一裁决。

## User Stories

1. 作为引擎维护者，我希望缓存回写策略只有一处定义，所以改门槛时三路（单命令/管道/复合）同时生效、不可能漂移。
2. 作为引擎维护者，我希望 pending-deny 优先序（会话 deny → pending → 持久 allow）有唯一所有者，所以「最近拒绝压过旧放行」这条最重要的安全序不再靠语句位置维持。
3. 作为引擎维护者，我希望 stats 从 Decision 单点记录，所以加一层裁决来源不再要同步四处计数代码。
4. 作为贡献者，我希望目录删除复核是一个独立模块，所以理解删除重试为何命中邻居不再需要通读管线全文。
5. 作为贡献者，我希望 session key 的构与拆在同一模块，所以改 key 格式不再跨文件对表。
6. 作为宿主适配层作者，我希望引擎构造只要求调参切片，所以新增 GuardConfig 键不再波及引擎接口与全部引擎测试。
7. 作为测试作者，我希望 spec setup 只需个位数键，所以 9 个 spec 文件的模板税消失。
8. 作为 agent 终端用户，我的裁决结果、理由、缓存行为、出线协议逐字节不变，所以这次重构对我不可见。
9. 作为审计者，我希望「行为零变化」有机器可验的证明，所以既有断言一条不改 + 口径等价清单钉死 stats 与回写时机。

## Implementation Decisions

- **施工序**：搬家 → 抽缝 → 切片；前一步缩小的体积是后一步 diff 可审的前提。
- **段裁决内缝**：私有 decideSegment（请求 + 段 + 上下文 → 段结论），不进公共 barrel——内缝而非外缝，宿主无法绕过 decide() 直调段评估。三份拷贝逐块等价性审计：逐字相同块直接合一；同义异形块合一；语义真分歧块参数化保留。
- **管道谓词**：唯一谓词 bypassesDeterministicTrust(command, {pipes}) 落 command.ts（紧邻其组合的两个原语）；shell 侧 bypass 检查保留含管道口径，模板缓存/历史层保留不含管道口径，审计行拼法维持现状——三口径记录为已知不一致，独立裁决留未来 spec。
- **记忆咨询**：consultMemories 收拢三级优先序为单一函数；guardMemory 逃生舱随缝内化；优先序语义不变。
- **stats**：record(decision) 单点记录，cache 命中从 Decision.source 推导；ruleHits 键集合从 DecisionSource 全集推导（类型形状不变，消灭手工双清单）。
- **引擎调参切片**：GuardTuning 纯数据 ~10 键（语言、双 TTL、always-review TTL、超时回调、文件追踪默认、历史开关与双阈值）；GuardService 构造签名收窄；切片在单点组合根发生；全量 GuardConfig 与持久化 schema 零变化。
- **删除复核模块**：新模块 surface = prepareRetry / matchPending / targetsOf；既有标记协议导出经公共 barrel 原路径 re-export，7 个调用方零改动；宿主事件格式解析随行（它是删除理由数据源，不是管线逻辑）；session key 构/拆成对归属缓存模块。
- **顺手清理**：删除全仓零调用者的 sessionIdOf 透传；guardReason 与 decideShell 共享确定性前缀抽取，两者返回值逐字节不变；spec setup() 返回其创建的依赖引用（治好伸进私有成员的测试钩子）。

## Testing Decisions

- **四门禁**：既有测试断言一条不改（只许改 import 与纯搬家导致的构造调用）；prompt 与 wire 出线逐字节 pin 维持；stats 计数口径与缓存回写时机以既有断言钉死并附等价断言清单；conformance 跨宿主等价矩阵全绿。
- **测试面**：既有三路（shell/pipeline/compound）测试就是段缝的行为规格——合并后原样保留即等价性证明，不需要新增「三路一致」对照测试（只剩一条路）。删除复核测试随模块搬家，断言不动。
- **新增只加不断**：directory-delete 模块可单测（matchPending 邻居匹配、targetsOf 提取）作为增量；GuardTuning 默认值快照测试。
- **先例**：guard-service.spec 的 stats 断言块、conformance 等价矩阵、SPEC 0013 迁移期的逐字节 pin 检查点。

## Out of Scope

- 管道谓词语义统一（含管道命令可否命中模板/历史层）——显式留待未来 spec，本次三口径原样保留。
- 管理 CLI、消息目录、宿主层收拢（SPEC 0020/0021/0022）。
- GuardConfig 持久化 schema、配置根布局（ADR-0003/0011 不碰）。
- 可配置管线/中间件化——无第二 adapter，假缝。

## Further Notes

- 评估快照（2026-09-25 架构扫描）：缓存回写三连 if 位于管线文件 :372/:486/:696 三处逐字；谓词拼法 command.ts :171、管线 :329/:928/:954、history.ts :43；session key 分持 cache.ts 与管线 :1120。
- 搬家先行同时降低后续两个 SPEC（0021 键迁移、0022 翻译下沉）触碰该文件的冲突面。
