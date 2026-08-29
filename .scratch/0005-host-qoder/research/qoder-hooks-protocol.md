# research: Qoder 国际版 hooks 协议（2026-08-29 官方文档深查；实施期证据补充见文末）

接 `0004-host-claude-opencode/research/qoder-hooks.md` 的"将来深查清单"。结论：**可行**，Qoder hooks 是 Claude Code hook 协议的字段级同构，host-claude 形态可直接平移。

来源：

- IDE + JetBrains 插件：https://docs.qoder.com/extensions/hooks（中文 https://docs.qoder.com/zh/extensions/hooks ）——本期目标产品
- Qoder CN CLI：https://help.aliyun.com/zh/lingma/hook ——旁证（CN 版不在范围）
- CLI / Agent SDK：https://docs.qoder.com/zh/cli/sdk/hooks ——本期不适配

## 旧清单逐项回答

1. **hooks 条目 schema** ✓：Claude 形态 `{"matcher": "...", "hooks": [{"type": "command", "command": "<shell 命令>", "timeout": <秒>}]}`。type 固定 `"command"`（不是 zcode 的 `"process"`+args 形态）；timeout 单位秒，IDE 默认 30、CN 默认 60。一个事件可配多个 matcher 分组，每组多个 hook。任一 hook 阻断则同事件其余 hook 跳过。
2. **PreToolUse payload / 裁决协议** ✓：
   - stdin JSON：通用 `session_id`、`cwd`、`hook_event_name`、`transcript_path`；PreToolUse 附 `tool_name`、`tool_input`、`tool_use_id`。官方明示"所有字段都可能为空"，防御式读取。
   - 环境变量：`QODER_SESSION_ID`、`QODER_TOOL_NAME`、`QODER_CWD`、`QODER_TRANSCRIPT_PATH`、`QODER_TOOL_INPUT_FILE_PATH`（CN CLI 另有 `QODER_PROJECT_DIR`）。
   - exit 0 = 放行（stdout JSON 仍会被解析做精细控制）；exit 2 = 阻断（stderr 注入对话）；其他退出码 = 非阻断错误，继续执行。
   - stdout JSON 顶层：`systemMessage`、`continueWithPrompt`、`decision`("block")、`reason`、`updatedToolOutput`、`hookSpecificOutput`。
   - PreToolUse 的 `hookSpecificOutput`：`permissionDecision`: `"allow"|"deny"|"ask"`、`permissionDecisionReason`、`updatedInput`（改写工具调用）、`additionalContext`。**与 Claude Code 字段级同构**。
3. **PermissionRequest / PermissionDenied 语义**：PermissionRequest 存在且可阻断，但 CLI 侧期望嵌套的 `decision.behavior` 结构（与 IDE 不同，官方明示脚本不能跨产品复用）。本期不用——ask 统一走 PreToolUse `permissionDecision: "ask"` 委托原生确认框。
4. **工具注册名** ✓：双命名集并存——`Bash`≡`run_in_terminal`、`Write`≡`create_file`、`Edit`≡`search_replace`、`Read`≡`read_file`；其余 `grep_code`/`Grep`、`search_file`/`Glob`、`delete_file`、`Skill`、`WebSearch`、`Task`/`Agent`、MCP 工具 `mcp__<server>__<tool>`。**无 NotebookEdit**。
5. **Windows 下 hook command 执行方式**：未确认（IDE 基于 VS Code 系，claude 的 shell-form 模板是先例，实施期实机验证）。
6. **版本要求**：未确认（本机 `D:\Program Files\Qoder` 已装且 settings.json 有 hooks 块，实施期确认最低版本即可）。

## matcher 语义（新发现，待实机验证）

文档称 matcher 支持：省略或 `"*"` = 全部；精确值（`"Bash"`）；`|` 分隔（`"Write|Edit"`）；正则（示例 `"mcp__.*"`）。正则是全匹配还是部分匹配未写明 → 首选锚定正则 `^(Bash|Read|Write|Edit|run_in_terminal|read_file|create_file|search_replace)$`，实机验证失败则回退 `"*"` + 适配层过滤（适配层本就 passthrough 未跟踪工具，代价是每次工具调用一次 node spawn，claude 窄 matcher 就是为了省这个）。SessionStart matcher 取值（`startup`/`resume`/`compact`?）同待验证。

## 各工具 tool_input 字段名（待实机验证）

官方文档未按工具列出 tool_input schema。`run_in_terminal` 的命令字段、`create_file`/`search_replace` 的路径与内容字段名需实机抓真实 payload，或解包 `D:\Program Files\Qoder\resources\` 的 asar grep（旧清单第 2 条的方法）。适配层先用防御式字段链 + fail-closed（读不到 → unreviewable → ask）。

## 配置文件与热重载

三文件按优先级合并：`~/.qoder/settings.json`（用户）< 项目 `.qoder/settings.json` < `.qoder/settings.local.json`。**无热重载，改完必须重启**。配置文件在 IDE / CLI / QoderWork 入口间共享，各入口只跑自己支持的事件——即 CLI 也可能执行我们写入的用户级 hooks（不承诺、不验证）。

## 本机状态（摘自旧 research）

`~/.qoder/settings.json` 已有 hooks 块（全空数组；事件名多出 `PermissionDenied`）。`~/.qodersec/` 是另一产品（CodeSec），无关。

## 实施期证据补充（2026-08-29，来源：随 Qoder 附带的 better-harness 插件）

`D:\Program Files\Qoder\resources\app\resources\plugins\bundle-plugins\better-harness\` 是随 Qoder 安装、以 Qoder 为默认目标平台的插件，其 `scripts/agent-guardrails/platforms.mjs` 与 `references/agent-customize/platforms/qoder.md` 是跑在真实 Qoder 上的第一手协议证据（`out/` 主包与 `extensions/` 内 grep 不到 PreToolUse——hook 引擎在主包的打包产物里，字符串不可 grep）：

1. **阻断输出（实装验证）**：`{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:…}}` + **exit 0**——与 claude 协议逐字段一致，本仓库 hook-output 形态原样可用。
2. **matcher 语义（裁定）**：随附插件 matcher 为不带锚点的管道分隔列表 `"Bash|Read|Edit|Write|apply_patch"`。本仓库采用同款风格 `"Bash|Read|Write|Edit|apply_patch|run_in_terminal|read_file|create_file|search_replace"`——无论 Qoder 按管道拆分精确匹配还是按正则子串匹配都正确（集合内名字互不为子串）。
3. **payload 字段（官方示例验证）**：随附文档的官方示例直接读 `.tool_name`（`"Bash"`）与 `.tool_input.command`——与 Claude Code 一致。文件工具的字段名官方未列出，适配层保留防御链：路径 `file_path→filePath→filepath→path`，内容 `content→file_text→new_string→newString→new_source`，读不到即 unreviewable→ask（fail-closed）。
4. **双命名**：随附插件 matcher 只用短名+`apply_patch`，未出现 `run_in_terminal` 等长名；长名按官方文档保留在 matcher 与适配层映射里（多覆盖无害）。
5. **仍未实机验证（需要真实 Qoder agent 会话，留给用户首装时确认）**：hook 实际触发与确认框弹出；SessionStart matcher `startup|resume` 的实际取值；Windows 下 hook command 的 shell 执行形态（模板沿用 claude 先例 `node "<path>"`）；hooks 生效的最低 Qoder 版本（本机 2025-08 构建有完整 hooks 块）。
