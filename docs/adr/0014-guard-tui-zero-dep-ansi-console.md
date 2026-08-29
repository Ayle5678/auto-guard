# 0014 — Guard TUI 零依赖手写 ANSI 控制台，动作层全走 runCli 单一事实源

## Context

非 DSH 宿主没有设置 UI，管理守卫只能拼命令行。参考 ccstatusline（React/Ink TUI）的体验标准做全屏管理控制台 `@auto-guard/tui`（SPEC 0009）。两个决策需要定档：TUI 用什么技术栈渲染；TUI 与既有命令语义的关系。

## Decision

**1) 零依赖手写 ANSI，不用 Ink/React。** 渲染分层：

- **驱动层**（薄、不测）：`readline` keypress 事件 + `stdin.setRawMode(true)` + alternate screen + 行级 diff 重绘（光标定位 + 清行）+ SIGWINCH/轮询双保险 resize + 退出恢复（`process.on('exit')` 兜底）。
- **组件层**（纯函数、全测）：CJK 感知宽度计算、powerline 头、面板/列表/滚动区/确认框/内联输入（含掩码）/spinner。`render(state) → string[]` 是唯一渲染入口。
- **状态层**：reducer + 屏状态机，键盘事件 → 状态 → 帧。

理由：本仓库运行时依赖纪律（core 零依赖、cli 仅 workspace 依赖、安装器手写 readline）一以贯之；安全工具不引入 React 运行时；双语界面必须自己做 CJK 宽度对齐（通用库也未必做对）；纯函数渲染让整套 UI 可在无终端环境下快照测试。代价是自绘组件的一次性成本，由组件层规模可控（十来个纯函数）封顶。

**2) 所有动作经 `runCli` / `runInstallerCommand`，TUI 不重写操作语义。** 管理动作 = `runCli([...argv, '--config-root', root])`；安装器动作 = `runInstallerCommand(['init', '--host', ids, '--yes', ...])`。回执（退出码 + 双语输出）原样进日志屏。结构化读（状态卡、安装计划预览）直接调 core/cli 已导出的读函数（`loadConfig`、`readStatus`、`detectHosts`、`buildInitPlan`、`buildRuleUpdatePlan`……）。语义永远只有一份：CLI 测过什么，TUI 就继承什么。

**3) `set set-key` 在 TUI 内自实现三步向导**（掩码输入、校验对齐 host-zcode 旧向导），因为统一 CLI 的该命令目前无条件拒绝（与 docs/cli.md 不符，SPEC 0009 已记录该差异）。密钥不过 argv、不进日志，只显示 `maskKey` 脱码。

**4) `packages/cli` 只加 exports 映射**（`./shell`、`./status-store`、`./installer`、`./profiles`），供 tui 深引；逻辑零改动。

## Consequences

- tui 包零运行时依赖，Node 内置模块 + workspace 依赖（cli、core）；沿用 type-stripping 运行时与 `engines: >=20` 声明（与 cli 现状一致）。
- 终端能力要求：VT 转义序列（Windows Terminal / Git Bash / ConEmu / mintty / 常见 SSH）；非 TTY 或 `TERM=dumb` 拒绝启动（exit 2）。`NO_COLOR` 尊重。
- 组件层快照测试可覆盖 UI 回归；驱动层保持薄到不值得测（与安装器 readline seam 同策略）。
- 主题/渐变/字体配置（ccstatusline 的可定制性）明确不做，v1 一套固定视觉；将来要做也不破坏分层。
