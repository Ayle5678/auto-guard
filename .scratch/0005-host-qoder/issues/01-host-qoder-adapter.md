# 01 — host-qoder 适配层

What to build:
- `packages/host-qoder/`（@auto-guard/host-qoder，Node 内置模块零依赖，镜像 host-claude 结构）：
  - `qoder-adapter.ts`：PreToolUse payload → GuardRequest。`GUARDED_TOOL_NAMES` 覆盖 Qoder 双命名集：Bash|run_in_terminal→bash、Write|create_file→write、Edit|search_replace→edit、Read|read_file→read（无 NotebookEdit）；tool_input 字段防御链（路径 file_path/filePath/path，内容 content/file_text/new_string 等，按实机验证结论收口）；snake_case 为主、camelCase 回退照 `claude-adapter.ts`；不可解析 payload → unreviewable（fail-closed，调用方转 ask）。`delete_file` 明确 passthrough（spec 范围裁剪）。
  - `qoder-capabilities.ts`：照抄 `CLAUDE_CAPABILITIES`（`askStyle: 'native'` + `headlessFallback: 'host'` + hasUI true + `sessionState: 'disk'`）。
  - `hook-output.ts`：同 claude 形态——`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow|deny|ask","permissionDecisionReason":"…"}}`；allow → 空 stdout（官方文档已核对字段，Qoder exit 0 也解析 stdout JSON）。
  - `hook-cli.ts`：镜像 claude hook-cli——stdin→GuardService→stdout，始终 exit 0（决策走 JSON，不走 exit 2）；catch-all 输出 **ask 级**（fail-closed 人工闸门，不得 deny 硬阻断）；审计/决策历史/status 落盘 + maybeSpawnAnalysis 原样保留。
  - `session-start.ts` + `bootstrap.ts`：镜像 claude（provisioning + 会话初始化）；`workspaceFromEnv()` 改 `QODER_PROJECT_DIR ?? QODER_CWD ?? cwd`。
  - `config.ts`：`AUTO_GUARD_DIR = ~/.qoder/auto-guard`（ADR-0003）。
  - `cli.ts`（guard ping/recent 等）镜像 claude。

实施期实机验证（结论回写本工单 Comments，必要时校正 spec）:
- matcher 正则是全匹配还是部分匹配（首选锚定双命名正则，失败回退 `"*"` + 适配层过滤）
- `run_in_terminal` / `create_file` / `search_replace` 的 tool_input 实际字段名（真机抓 payload，或解包 `D:\Program Files\Qoder\resources\` grep）
- Windows 下 hook command 的执行方式（shell-form `node "<path>"` 是否可用，对齐 claude 模板先例）
- SessionStart matcher 取值（startup/resume/compact?）
- hooks 生效最低 Qoder 版本

Blocked by: —
Status: done

Acceptance:
- [x] 单测：双命名工具 payload→GuardRequest 翻译、字段防御链、delete_file passthrough、不可解析 payload→unreviewable
- [x] 单测：Decision→permissionDecision 三态输出；allow 静默（空 stdout + exit 0）；异常输入 fail-closed（ask 级）
- [x] 集成冒烟：`node dist/hook-cli.js` 吃样例 payload 出正确 JSON（scripts/smoke/smoke-qoder.mjs，allow/deny/run_in_terminal 三例 PASS）
- [x] 实机验证五项有结论并回写 Comments；matcher/模板如需变更同步 02 工单

## Comments

### 实施结论（2026-08-29）

- 双命名映射落地为 9 项：短名 Bash/Read/Write/Edit + 长名 run_in_terminal/read_file/create_file/search_replace + `apply_patch`→edit 别名（zcode ApplyPatch 先例）。
- **matcher 裁定**：采用随 Qoder 附带的 better-harness 插件同款**不带锚点的管道分隔列表**（`Bash|Read|Write|Edit|apply_patch|run_in_terminal|read_file|create_file|search_replace`）——无论 Qoder 按管道精确匹配还是按正则子串匹配都正确，绕开了"锚定正则 vs 管道拆分"的不确定性；不需要 `"*"` 回退方案。
- **payload 字段**：官方示例（随附插件文档内）证实 `.tool_name`/`.tool_input.command`；文件工具字段名官方未列出，适配层保留防御链（`file_path/filePath/filepath/path`；`content/file_text/new_string/newString/new_source`），读不到 → unreviewable → ask。
- **matcher/SessionStart/Windows 执行/最低版本**四项的真机会话验证（真实 agent 会话里触发 hook）留作用户首装确认——已尽可能从随 Qoder 插件产物取证，详见 `research/qoder-hooks-protocol.md` 文末"实施期证据补充"。
