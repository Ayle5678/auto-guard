# 0004 — 新宿主：Claude Code + OpenCode

## Spec

用户机器上的 agent 宿主不止 DSH/Pi/ZCode。本功能接入 **Claude Code** 与 **OpenCode** 两个新宿主，全部走既有扩展路径（ADR-0007 能力声明 + ADR-0008 profile 数据驱动），core 零改动。

范围裁剪记录（grilling 两轮结论）：

- **Hermes 放弃**：shell hook 仅 block/放行两态、无 ask 通道；宿主侧 fail-open（hook 崩溃=放行）；注册只能手改 config.yaml（无 CLI add）；本机实际配置目录在 `%LOCALAPPDATA%\hermes`（HERMES_HOME 解析，与 `~/.hermes` 分裂）。协议细节已归档 `research/hermes-shell-hooks.md`，将来若做建议改走 Python 插件（`approve` 指令可升级到 hermes 原生审批门）。
- **Qoder 放弃（范围收敛，非不可行）**：`~/.qoder/settings.json` 存在 Claude 风格 hooks 块（PreToolUse/PermissionRequest/SessionStart 等，事件名同构，本机全为空数组），协议未深查。入口留 `research/qoder-hooks.md`。
- 用户机器上其余 agent 工具（codex、cline、qwen-agent 等）不探测不适配，留给后续 profile。

### 前置条件

- **opencode 启动器损坏**：本机 npm 安装 opencode-ai@1.18.19 时 postinstall 未执行，`opencode` 命令启动即报错；平台二进制 `opencode-windows-x64` 本体在。实施第一步跑一次 `node <全局包>/postinstall.mjs` 修复（机器运维项，非仓库改动）。
- 检测不依赖 opencode 可执行探测（见 04 工单：以文件证据为主），启动器损坏不阻塞安装器开发。

### Claude Code（zcode 镜像，ADR-0007/0008 的直接应用）

- 集成点：PreToolUse hook（进程命令），事件协议与 zcode 同为 Claude 兼容 hook 协议（snake_case payload）。
- 守卫工具集 matcher：`^(Bash|Read|Write|Edit|NotebookEdit)$`（比 zcode 多 NotebookEdit→edit 映射，覆盖 .ipynb 写路径；少 zcode 特有的 ApplyPatch）。
- 能力声明：`askStyle: 'native'`（ask → Claude Code 原生确认框）+ `headlessFallback: 'host'`，与 zcode 同构。
- 安装：json-merge 写 `~/.claude/settings.json` 的 `hooks.PreToolUse` + `hooks.SessionStart`（镜像 zcode 两条 entry），markerSuffix 标识可幂等重写、可完整卸载。
- 配置根：`~/.claude/auto-guard/`（ADR-0003 惯例，每宿主独立）。
- **已知风险**：本机 cc-switch / clawd 曾把 settings.json 的 hooks 整体清掉（`settings.json.orig/.bak` 证据，现存三个清理备份）。v1 对策 = 文档警示 + init 完成后验证提示（提示用户运行 `guard ping` 确认 hook 活着），不做自动守护。

### OpenCode（permission.ask 委托，见 ADR-0011）

- 集成点不是进程 hook 而是宿主权限系统：安装器往 `~/.config/opencode/opencode.json` 写 permission 规则（`bash`/`edit`/`read` → `"*": "ask"`），守卫插件在 `permission.ask` hook 中跑完整裁决管线。
- ask 落点：guard 自身的 ask **不改写** `output.status`，落 opencode 原生 TUI（一次 / 本会话总是 / 拒绝）。用户选"本会话总是"后同模式调用经宿主放行、不再进守卫——与 zcode 委托宿主权限系统同性质，接受。
- permission 规则写入必须**保留用户既有规则且让用户规则优先**：opencode 对象语法后者匹配者优先，故 `"*": "ask"` 插入到该工具对象**首位**；工具键已存在含 `"*"` 时不动（幂等 no-op，remove 也不删——无法区分归属，文档说明）。
- 参数兜底：`permission.ask` 的 `Permission.metadata` 字段键名实现期核实；不足处用 `tool.execute.before`（先于 ask 触发，按 callID 暂存 args）补齐。
- 进程模型：插件跑在 opencode 的 bun 进程内，但每次裁决 **spawn `node …/host-opencode/dist/hook-cli.js`**（与 claude/zcode 进程 hook 完全同构），core 不进 bun 进程。已知妥协：每次 read 走一次 node spawn（静态放行路径几十毫秒），实测慢再优化。
- 插件注册：json-merge 往 opencode.json 的 `"plugin"` 数组追加条目（绝对路径，pi `srcIndex` 先例；本机 clawd 备份文件证明本地路径条目可用；指向包目录还是单文件由 04 工单实测定）。不做插件运行时自改 permission（config hook 方案）——违反 ADR-0008 显式写入原则。
- 能力声明：`askStyle: 'native'` + `headlessFallback: 'host'`；配置根 `~/.config/opencode/auto-guard/`；provisioning 在守卫进程首次调用时惰性完成（无独立 session hook）。

### 通用

- 命名：HostId 增 `claude`、`opencode`；包 `@auto-guard/host-claude`、`@auto-guard/host-opencode`。
- 两新宿主接入 conformance 等价性矩阵与 fail-closed 矩阵。
- fail-closed 纪律：不可解析 payload → ask（claude）/ 宿主 ask（opencode）；守卫进程崩溃时 claude 侧 catch-all 输出 deny 级决策，opencode 侧插件 catch 后不改写 status 落原生 TUI（不得 throw——throw 会被宿主当作工具错误而非权限裁决）。

Design: ADR-0011（opencode permission.ask 委托与进程隔离）。

## Issues

- 01-host-claude-adapter.md — host-claude 适配层（payload 翻译 + 能力声明 + hook-cli/session-start）
- 02-claude-installer-profile.md — claude profile（检测 + settings.json hooks 写入/卸载）
- 03-host-opencode-plugin.md — host-opencode 插件（permission.ask 驱动 + spawn 进程模型）
- 04-opencode-installer-profile.md — opencode profile（检测 + plugin 数组 + permission 规则写入）
- 05-conformance-new-hosts.md — conformance 等价性与 fail-closed 矩阵接入
- 06-docs-new-hosts.md — 手册/README/警示与修复指引

Status: done
