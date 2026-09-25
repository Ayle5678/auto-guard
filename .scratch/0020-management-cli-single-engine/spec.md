# 0020 — 管理 CLI 单引擎：createCliMain 深化 + 能力声明

> Status: implemented (SPEC 0020 完成于本次提交；三门禁全绿)
> 决策依据：ADR-0022；grill-log Round 16 Q1–Q3。补完 ADR-0009 在 dispatch 层的统一。

## Problem Statement

同一条管理命令语法（guard / set / examine / optimize，约 15 个共享动作）存在两份实现：统一管理 CLI（packages/cli）与宿主运行时 CLI（host-runtime）。examine 子命令逐行同构，其余仅输出 sink 与根解析不同。dispatch 层分叉已造成能力漂移——ask 逃生舱组与 set-key 交互向导只长在运行时侧、聚合状态只长在 cli 侧——且每个新子命令都要双实现。终端用户今天无感；付税的是贡献者与下一个子命令的作者。

## Solution

把宿主运行时已有的 createCliMain 深化为唯一引擎（dispatch、渲染、退出码、usage 全内化）；CliParts 增加真实变量点作 adapter 参数——根解析模式（自动探测 vs 描述符钉根）、输出 sink、程序名（usage 前缀）与**能力声明**（命令组开关）。两个入口退为薄驱动：cli 驱动声明「无 ask 组、含聚合状态」，运行时驱动声明「含 ask 组与向导、无聚合状态」——今天每个入口能做什么，重构后逐字节相同。

## User Stories

1. 作为 CLI 用户（任一入口），我的命令面、参数、输出与退出码逐字节不变，所以重构对我不可见。
2. 作为贡献者，我希望新子命令只落一处，所以两个入口在其能力声明内同时获得。
3. 作为 TUI 用户，我的回执与命令模式行为不变（TUI 的 runCli 接口不动，内部换引擎）。
4. 作为已安装用户，我的安装形态与入口路径零变化（安装器 profile 不动）。
5. 作为架构审计者，我希望两个 CLI 的行为等价有 conformance 钉子，所以未来漂移会红。
6. 作为「ask 组要不要进 cli」的 future 决策者，我希望那是一行能力声明的翻转，而不是一次移植工程。

## Implementation Decisions

- **引擎归属**：createCliMain 留宿主运行时（不下沉 core——core 是裁决引擎不是 CLI 框架；引擎只出操作，语法与出口归运行时）。
- **能力声明**：CliParts 的命令组开关字段；cli 驱动与运行时驱动各自声明现状能力集，合并不带来任何入口的命令面扩大或缩小。
- **程序名参数化**：usage 文案的程序前缀（auto-guard vs node dist/cli.js）作 CliParts 字段。
- **packages/cli 剩余职责**：安装器 + 根探测 + 聚合视图 + 驱动壳；安装器 profile 与入口路径零改动（ADR-0008 可逆性不碰）。
- **TUI**：runCli(argv) interface 与回执语义不变。
- **施工前置**：动工前 conformance 先钉两 CLI 当前行为快照（含 exit code 表逐值）。

## Testing Decisions

- **先钉后动**：conformance 增两 CLI 行为等价断言（命令分发、输出、退出码）作为第一步，重构在绿灯下进行。
- 既有 cli 与 host-runtime 的 CLI 测试断言不动；usage 断言随程序名参数化只改注入值。
- 三门禁（typecheck / test / smoke）全绿；TUI smoke 证明 runCli 行为不变。

## Out of Scope

- 能力面对齐或扩大（ask 组进 cli、聚合进运行时、向导共享）——改使用，无人要求。
- 守卫面文案键搬家（SPEC 0021，施工在本 spec 之后，usage 键迁移随它走）。
- 安装器功能、新子命令。

## Further Notes

- 漂移证据（2026-09-25 扫描）：ask 组与 set-key 向导仅存运行时侧（其 cli.ts :168-218/:382-433），聚合状态仅存 cli 侧（shell.ts :218-249），cli 的 set-key 是 TTY 拒绝 stub。
- 与 SPEC 0019 完全独立可并行；与 SPEC 0022 的 dsh CLI 面（remote 设置页）无交集。
