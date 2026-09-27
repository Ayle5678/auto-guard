# 守卫面共享文案目录：守卫面键归 core，宿主只留 chrome

七个消息目录里，同一守卫面键最多三处定义且措辞已语义漂移：deleteFail 双标题三种中文措辞（host-runtime「本次删除」/ pi「这次删除未过审」/ dsh「否决了这次删除」）、rollbackDone 与 analyzeDone 各三种拼法、pingOk/examine*/showKey* 三目录逐字重复——CONTEXT「消息目录」词条旧表述「文案归各包所有，跨包只共享取词函数」把重复制度化，改一句用户可见的话要跨三包。决策：守卫面键（回执、usage、删除流程、密钥与审计、分析回执）提升为 core 的**共享守卫面目录**（defineCatalog 旁导出）；键迁移三步审计——(a) 同键逐字相同直接搬（多数）；(b) 同义异形选语义最准者统一为正典（微调个别用户可见文案，不改变任何判断与操作方式，键级 diff 清单进 spec 验收可审计）；(c) 措辞承载宿主上下文的走描述符 catalogOverride 数据槽保留（ADR-0016 已建机制）。host-runtime / pi / dsh / cli 目录瘦身为宿主 chrome（对话框、设置页、安装器、TUI 文案）。ADR-0011 的机制不动——四层语言解析、defineCatalog 类型对齐、每包目录纪律照旧，动的只是键的家。CONTEXT「消息目录」词条相应修订。

## Considered Options

- 三份措辞全保留、靠 catalogOverride 表达差异：拒绝——重复制度化，漂移照旧；override 是为宿主真味道设计的，不是为同义词设计的。
- 全仓单目录（连 chrome 也收进 core）：拒绝——安装器、TUI、pi 对话框、dsh 设置页是真宿主 chrome，收进来 core 变文案倾倒场，且违反 ADR-0011 每包目录纪律的本意。
- 跨包键引用（pi 目录 import core 的键常量）：拒绝——defineCatalog 的类型对齐按目录工作，跨目录引用破坏「键一致、类型强制对齐」机制。
- 守卫面目录放 host-runtime：拒绝——pi 与 dsh 不经 host-runtime，cli 也依赖 core 而非 host-runtime；core 是唯一公共下游。

## Consequences

- 少数用户可见文案统一为正典（SPEC 验收附键级 diff 清单，每一处变化可审计）；此为「不改变判断」约束下唯一被接受的可见变化。
- 新守卫面键一处定义、全宿主生效；deleteFail 标题键随裁决翻译下沉（ADR-0025）获得唯一查词点。
- 宿主包目录行数显著下降（host-runtime ~72 键、pi ~86 键的大部分守卫面键搬走）；「文案归各包所有」旧表述被「守卫面归 core、chrome 归各包」取代。
- 宿主措辞差异的合法通道只剩 catalogOverride 数据槽——措辞漂移从此有唯一的、显式的表达处。
