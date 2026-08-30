# opencode 经宿主权限评估接入：permission.ask 委托原生 ask，spawn node 进程隔离 bun

> **实现期修订（2026-08-29，工单 03）**：对 opencode 1.18.19 编译产物与 v1.18.19 源码核实——`permission.ask` plugin hook **只有类型定义、宿主从不派发**（全部 `trigger()` 调用点枚举无此事件，同 [issue #7006](https://github.com/anomalyco/opencode/issues/7006)）。本决策的裁决语义全部保留，交付机制换为：插件 `event` hook 监听 `permission.asked` 总线事件（`"*.": "ask"` permission 规则使其触发）→ spawn `node hook-cli.js` 裁决 → `client.permission.reply` 答复（allow→once、deny→reject+理由、ask→不答复落 TUI）。`permission.ask` hook 实现保留为前向兼容。核实过程与 metadata 键名见 `.scratch/0004-host-claude-opencode/research/opencode-plugin-api.md` 实现期补核段。

opencode 的守卫点不是工具分发前的进程 hook，而是宿主权限系统：安装器显式写入 permission 规则（bash/edit/read → `"*": "ask"`，插入各工具对象首位，用户既有规则在前故优先），守卫插件在宿主权限评估处运行完整裁决管线——allow/deny 直接答复，guard 自身 ask 不答复、落 opencode 原生 TUI（一次/本会话总是/拒绝）。用户在 TUI 选"本会话总是"后同模式调用经宿主放行、不再进守卫——与 zcode 委托宿主权限系统同性质，接受。插件本体跑在 opencode 的 bun 进程内，但每次裁决 spawn `node host-opencode/dist/hook-cli.js`，core 不进 bun 进程，与 claude/zcode 的进程 hook 形态完全同构。

## Considered Options

- tool.execute.before 全量裁决、ask→throw：拒绝——throw 在宿主侧是工具错误不是权限裁决，且放弃 opencode 独有的原生 ask，守卫 ask 退化为阻断。
- 插件直接 import core 进 bun 进程：拒绝——bun 兼容性未验证（加密存储等 native 面），省下的 spawn 开销相对 LLM 裁决可忽略。
- 插件 config hook 运行时自改 permission 规则：拒绝——违反 ADR-0008 显式写入、备份、可还原原则，`auto-guard remove` 无法撤销。

## Consequences

- opencode 的覆盖面等于宿主权限评估面：用户既有 permission 规则放行的调用不进守卫（文档明示）。
- 每次 read 走一次 node spawn（静态放行路径几十毫秒），记为已知妥协，实测慢再优化（备选：静态放行层移入插件进程内）。
- capability 声明 `askStyle: 'native'` + `headlessFallback: 'host'`，与 zcode/claude 同构。claude 宿主是 ADR-0007/0008 预测路径的直接应用（zcode 镜像：PreToolUse 进程 hook + 原生确认框），无意外决策，不单独立 ADR。
- 守卫插件异常时不得 throw：status 原样 = 落宿主 TUI，由宿主 ask 兜底（非 fail-open，最终仍有人工闸门）。
