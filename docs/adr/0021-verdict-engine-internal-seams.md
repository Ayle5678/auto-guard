# 裁决引擎内聚：段裁决内缝 + 引擎调参切片 + 删除复核独立模块

guard-service.ts（1260 行）外深内浅：对外 interface（decide / guardReason / rememberAsk / clearSessionCache / resetStats / stats）已足够小，但内部把「评估一条简单命令」这一域内概念在 decideShell / decidePipeline / decideCompound 三个循环里手工同步——缓存回写三连 if 三处逐字拷贝、「不可确定性放行」谓词四种拼法、pending-deny 三个 helper 分持，且管线顺序只靠语句位置维持。同时 GuardConfig 47 键超集穿透构造接口（引擎实际消费 ~10 键，45 行 makeConfig 模板在 9 个 spec 文件逐字重复），目录删除复核协议 ~440 行（重试状态机、删除标记文本协议、Remove-Item/事件解析）混在管线文件尾部，session key 语法由 guard-service 与 cache.ts 分持。决策（纯结构重构，行为零变化）：(a) 抽私有 `decideSegment` 内缝（internal seam，不进公共 barrel），三个 decide* 退为薄组合策略，逐块等价性审计后合一——语义真分歧处（管道谓词三口径：shell 侧含 `|`、模板/历史侧不含）参数化**显式保留**，唯一谓词 `bypassesDeterministicTrust(command, {pipes})` 落 command.ts，分歧记录为已知不一致、独立裁决留给未来 spec；(b) `consultMemories` 收拢「会话 deny → pending deny → 持久 allow」优先序为单一函数（优先序不变，只是获得唯一所有者）；(c) stats 从 11 处手织递增改为 `record(decision)` 单点记录（source 已在 Decision 上），计数口径以既有断言钉死；(d) 新类型 GuardTuning（引擎调参切片，~10 键纯数据），GuardService 构造签名收窄，全量 GuardConfig 留在宿主配置层、持久化 schema 零变化，切片在单点组合根（host-runtime/guard-deps.ts）发生；(e) `core/src/directory-delete.ts` 拆出删除复核（prepareRetry / matchPending / targetsOf + 标记协议导出经 barrel 原路径 re-export，调用方零改动），session key 语法成对归属 cache.ts（build 与 split 同主）；顺带删除全仓零调用者的 `sessionIdOf`。施工序：先搬家 (e) 把文件缩到 ~820 行，再抽缝 (a–c)，最后切片 (d)。验证四门禁：既有测试断言一条不改、prompt/wire 逐字节 pin 维持、stats 与缓存回写口径既有断言钉死、conformance 等价矩阵全绿。

## Considered Options

- 统一管道谓词到严格端（含 `|` 即禁模板/历史层）或宽松端：双拒——任一端都改变今天带管道命令的裁决路径，违反「不改判断」根约束；分歧显式化后留待未来 spec 裁决。
- decideSegment 公开导出：拒绝——外缝会诱惑宿主绕过 decide() 直接调段评估，出线协议失控；内缝私有才能保证「一条管线一个入口」。
- GuardConfig 拆为落盘子 schema：拒绝——改持久化格式与宿主加载路径，影响面远超引擎接口收窄的收益。
- 删除复核就地整理不拆文件：拒绝——key 语法分持与管线文件超宽的核心摩擦原样保留，等于没做。
- stats 改由缓存 adapter 主动上报：拒绝——命中计数语义横跨 session/persistent/template/history 四层，从 Decision.source 单点推导更贴近既有口径，adapter 上报会重演「多处同步」。
- 为 decideSegment 引入可配置管线/中间件：拒绝——只有一种真实执行序（CONTEXT「裁决管线」），无第二 adapter，假缝。

## Consequences

- guard-service.ts 1260 → 约 820 行（搬家后）纯管线；缓存策略、pending-deny 优先序、回写门槛、stats 各获得唯一所有者——改一处三路同时生效，漂移类别消灭。
- 管道谓词口径不一致（shell 含管道 vs 模板/历史不含）从隐蔽变成显式记录的已知不一致；任何未来统一都是一次可独立评审的行为变更。
- 9 个 spec 的 makeConfig 收敛为个位数键的 makeTuning；guard-service.spec 伸进私有 llmReviewer 的钩子随 setup() 返回依赖引用而治好。
- GuardTuning 是新的公共类型（进 barrel），宿主不直接构造它——组合根切出；新增 GuardConfig 键不再波及引擎 interface。
- 「段裁决」保持私有概念，不进 CONTEXT 术语表（不进公共语言的实现细节）；GuardTuning、目录删除复核的可测试面扩大（从「经 decide() 全管线」变为可单测的独立模块）。

## Known inconsistency: 管道谓词三口径（SPEC 0019 票02 入档）

唯一谓词 `bypassesDeterministicTrust(command, { pipes })`（command.ts）落点之后，今天仍并存三种口径。**本 spec 显式不裁决**，任何统一都是一次可独立评审的行为变更，留未来 spec：

1. **shell 决策路（含管道）**：`bypassesDeterministicTrust(command, { pipes: true })` —— decideShell 单命令 static/user-confirmed 门与管线/复合各 plainSafe 组合项。管道即禁确定性放行。
2. **模板缓存 / 历史层（不含管道）**：`bypassesDeterministicTrust(command, { pipes: false })` —— templateCacheDecision 与 historyDecision 的入场门。带纯管道命令今天仍可命中模板/历史层。
3. **审计行过滤（原样拼法）**：history.ts 索引侧的 `includes('$(') || includes('`') || /[<>]/` 字面检查维持现状（未换谓词：谓词会额外排除 `<(`/`>(` 行，属行为变化）。

差异含义：同一条带管道命令，shell 路径绝不确定性放行，但可被模板/历史层放行；审计索引比历史层入场门更宽松（不排除 process substitution）。
