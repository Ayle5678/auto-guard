# 0005 — 新宿主：Qoder（国际版 IDE）

## Spec

接入 **Qoder 国际版 IDE** 单宿主，全部走既有扩展路径（ADR-0007 能力声明 + ADR-0008 profile 数据驱动），core 零改动。0004 曾因协议未深查收敛掉 Qoder，本期接上：协议已深查（`research/qoder-hooks-protocol.md`），结论为 **Claude Code hook 协议的字段级同构**（PreToolUse + `hookSpecificOutput.permissionDecision: allow|deny|ask`），host-claude 形态直接平移。

范围裁剪（用户 2026-08-29 拍板）：

- **只做国际版**：集成点写 `~/.qoder/settings.json`（用户级）。CN 版（`~/.qoder-cn/`，阿里云灵码系）不做、不探测、不写 profile。
- **Qoder CLI 不适配**：不验证、不承诺。注意一个接受的副作用：hooks 写在用户级配置，而配置文件在 IDE/CLI/QoderWork 入口间共享（官方文档"each entry point only runs the events it supports"），CLI 若支持同名事件也会执行我们的 hook——不为此做适配或测试，文档说明即可。
- **LLM 只走 API 模式，无"Qoder 内置模型"模式**：Qoder 无官方推理 API（唯一官方 OpenAPI 是团队管理/用量统计接口）；社区逆向项目 qoder-proxy 违反 ToS、随时会断，安全审查工具不依赖。Qoder BYOK（DeepSeek/百炼等）与 API 模式等价——同一把 key 守卫直连即可，无需独立模式。裁决 LLM 配置照旧落 `~/.qoder/auto-guard/config.json`（key 水合链 ADR-0006 不变）。
- **delete_file 不守卫（v1）**：Qoder 特有的文件删除工具。GuardRequest 工具枚举（bash/pwsh/write/edit/read）不含 delete，扩枚举是 core 改动，超出"镜像 claude"的范围；且经 bash 的 `rm`/`del` 已被守卫。留作后续独立 feature。
  - （2026-08-30 更新：SPEC 0012 撤销此裁剪——`delete_file` 以 bash `rm "<路径>"` 合成纳入守卫，不扩 GuardRequest 枚举。）
- **无新 ADR**：0007/0008 的直接应用，没有新 kind 的集成写入（对照产出 ADR-0011 的门槛）；协议同构性记录在 research 文件。

### Qoder（claude 镜像）

- 集成点：PreToolUse 进程 hook（`type: "command"` + `timeout` 秒），json-merge 写用户级 `~/.qoder/settings.json` 的 `hooks.PreToolUse` + `hooks.SessionStart` 两条 entry（array-append + markerSuffix，幂等重写、`remove` 完整卸载——镜像 claude profile）。
- matcher：`^(Bash|Read|Write|Edit|run_in_terminal|read_file|create_file|search_replace)$`——覆盖 Qoder 双命名集；正则语义待实机验证，失败回退 `"*"` + 适配层过滤（适配层本就 passthrough 未跟踪工具）。
- 守卫工具映射：`Bash|run_in_terminal`→bash、`Write|create_file`→write、`Edit|search_replace`→edit、`Read|read_file`→read。无 NotebookEdit（Qoder 工具集没有）。
- 输出协议：与 claude 完全同形（`hookSpecificOutput.permissionDecision` + `permissionDecisionReason`，官方文档已核对字段）；allow → 空 stdout + exit 0。
- 能力声明：照抄 `CLAUDE_CAPABILITIES`（`askStyle: 'native'` + `headlessFallback: 'host'`，ask → Qoder 原生确认框）。
- 配置根：`~/.qoder/auto-guard/`（ADR-0003，每宿主独立）。
- workspace 解析：`QODER_PROJECT_DIR` → `QODER_CWD` → cwd 回退（claude 的 `CLAUDE_PROJECT_DIR` 镜像）。
- fail-closed 纪律：不可解析 payload / unreviewable → ask（原生确认框 = 人工闸门）；守卫进程 catch-all 输出 **ask 级**（claude 先例，非 deny——守卫自身故障不得硬阻断一切）。
- session-start：镜像 claude（provisioning + 会话初始化），timeout 30 秒。
- 实施期实机验证项（详见 research，01 工单收口）：matcher 正则语义、双命名工具的 tool_input 实际字段名、Windows hook command 执行方式、SessionStart matcher 取值。
- 无热重载：装完必须新开会话（sessionNote 文案），验证提示照 claude（`guard ping`）。

### 通用

- 命名：HostId 增 `qoder`；包 `@auto-guard/host-qoder`。
- i18n：中英 usage/uninstallHint 宿主列表加 qoder；新增 `sessionNoteQoderHooksNoHotReload`、`qoderVerifyHint`（MessageKey 类型强制对齐）。
- conformance 等价性矩阵与 fail-closed 矩阵接入 qoder 行。
- 手册/README/CONTEXT.md 宿主清单 5→6。

Design: 无新 ADR（ADR-0007/0008 应用）；协议深查归档 `research/qoder-hooks-protocol.md`。

实施期校正（2026-08-29，code-review 后）：

- matcher 与适配层在 spec 文本的 8 个名字外**多覆盖 `apply_patch` 别名**（→edit，zcode ApplyPatch 同角色）——证据来自随 Qoder 附带的 better-harness 插件 matcher（`Bash|Read|Edit|Write|apply_patch`），多覆盖无害，已记入 01 工单与 research。
- matcher 形态从 spec 草案的「锚定正则 `^(…)$`」改为随附插件同款的**不带锚点管道分隔列表**——绕开"正则全匹配 vs 管道精确匹配"的语义不确定性，两种解释下都正确（见 01 工单 Comments）。
- 02 工单安装器模板 `timeout` 定为 PreToolUse 90 秒 / SessionStart 30 秒（claude 先例，LLM 时延预算）。

## Issues

- 01-host-qoder-adapter.md — host-qoder 适配层（双命名翻译 + 能力声明 + hook-cli/session-start + 实机验证收口）
- 02-qoder-installer-profile.md — qoder profile（检测 + settings.json hooks 写入/卸载 + i18n 文案）
- 03-conformance-qoder.md — conformance 等价性与 fail-closed 矩阵接入
- 04-docs-qoder.md — 手册/README/CONTEXT.md 宿主清单与警示

Status: done（唯一遗留：真实 Qoder 会话中的 hook 触发实测，见 01/02 工单 Comments 与 research 文末）
