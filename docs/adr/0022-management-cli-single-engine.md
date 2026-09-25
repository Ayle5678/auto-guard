# 管理 CLI 单引擎：createCliMain 深化 + 能力声明，packages/cli 退为薄驱动

ADR-0009 统一管理 CLI 时把操作沉进了 core（commands.ts），但 ADR-0016 抽出 host-runtime 时 dispatch/渲染/退出码层分叉了：packages/cli/src/shell.ts 与 host-runtime/src/cli.ts 把同一命令语法（guard/set/examine/optimize ~15 个动作）实现两遍，examineCommand 逐行同构，能力已漂移——ask 逃生舱组、set-key 交互向导只长在 host-runtime 侧，聚合状态只长在 cli 侧——新增子命令必须双实现或任其漂移。决策：把 host-runtime 已有的 `createCliMain(CliParts)` 深化为唯一引擎（dispatch、渲染、退出码、usage 全部内化）；CliParts 增三个真实变量点作 adapter 参数——根解析模式（自动探测 vs 描述符钉根）、输出 sink、**能力声明**（命令组开关：cli 驱动声明「无 ask 组、含聚合状态」，runtime 驱动声明「含 ask 组与向导、无聚合状态」）——以及程序名参数（usage 文案 `auto-guard` vs `node dist/cli.js`）。packages/cli 退为：安装器 + 根探测 + 聚合视图 + 驱动壳；TUI 的 runCli(argv) interface 与回执语义不变；安装器 profile 与入口路径零改动。动工前 conformance 先钉两 CLI 当前行为快照（含 exit code 表逐值）。

## Considered Options

- 借合并把能力面对齐（cli 获得 ask 组 / runtime 获得聚合状态）：拒绝——扩大任一入口的命令面都是「改变使用」，无人要求；能力声明让今天每个入口能做什么，明天逐字节相同。
- dispatch 层下沉 core：拒绝——core 是裁决引擎不是 CLI 框架，渲染与 io 归宿主层（ADR-0002 精神）；引擎只出操作（commands.ts），语法与出口归 host-runtime 单引擎。
- 维持两 CLI 现状、以文档约定同步：拒绝——漂移已经发生（三处），文档约定不改变「双实现税」。
- 把 set-key 向导做成共享组件强行走 cli：拒绝——向导依赖 runtime 的 kit 空间模型，cli 侧是 TTY 拒绝 stub 是既有产品决策，合并向导属扩面。

## Consequences

- 新子命令落一处，两个入口同时获得（在其能力声明范围内）；「ask 组要不要进 cli」成为一行能力声明翻转，而非一次移植。
- usage/examine/统计类文案键随守卫面目录（ADR-0023）单源化，程序名以参数注入。
- conformance 新增两 CLI 行为等价断言——CLI 层第一次有跨入口等价钉子。
- packages/cli 的剩余职责（安装器、根探测、聚合视图）边界更清晰；ADR-0009 的「统一 CLI」在 dispatch 层补完，而非被推翻。
