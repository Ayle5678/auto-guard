# 03 — packages/cli 退薄驱动：消费单引擎

**What to build:** 统一管理 CLI 退为薄驱动：消费深化后的 createCliMain，声明「无 ask 组、含聚合状态」；自身保留安装器、根探测（自动探测 vs 描述符钉根的变量点）、聚合视图与驱动壳。两个入口此后共享一条命令语法实现——今天每个入口能做什么，重构后逐字节相同。TUI 的 runCli 接口与回执语义不变；安装器 profile 与入口路径零改动。

**Blocked by:** 02（引擎深化就位）.

**Status:** resolved

- [x] packages/cli 全部子命令经单引擎分发；本地只剩安装器/根探测/聚合视图/壳
- [x] cli 侧行为快照逐字节绿（含聚合状态、set-key TTY 拒绝 stub 维持现状）
- [x] TUI 回执与命令模式行为不变（TUI smoke 绿）
- [x] 安装器 profile 与入口路径零改动（安装 smoke 绿）
- [x] 三门禁 + conformance 全绿
