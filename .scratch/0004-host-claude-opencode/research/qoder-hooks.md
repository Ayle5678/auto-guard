# research: Qoder hooks 线索（2026-08-29 快查，范围收敛暂缓）

结论：**暂缓（非不可行）**。Qoder 存在 Claude Code 风格的 hooks 机制，事件名高度同构；因范围收敛（本分支只做 claude + opencode）未做协议深查。此文件是将来适配的入口。

## 本机状态

- IDE：`D:\Program Files\Qoder\bin\qoder`（VS Code 系）；数据目录 `~/.qoder/`（agents/commands/plugins/rules/skills/memories/mcp.json/settings.json 等，布局贴近 Claude Code 约定）。
- 变体目录：`~/.qoder-cn/`（CN 版，结构类似）、`~/.qoder-cli/`（仅 ai-stats）、`~/.qodersec/`（**另一产品** CodeSec 安全扫描器，config.yaml 是扫描/审查配置，与 agent hooks 无关）。
- `~/AppData/Roaming/Qoder/`：Electron 缓存数据（Cache/GPUCache/User 等）。
- mcp.json：codegraph、obsidian 两个 stdio server（说明扩展面，非拦截点）。

## 已确认的 hooks 存在证据

`~/.qoder/settings.json`：

```json
{
  "enabledPlugins": { "better-harness@qoder-bundler": true, "caveman@qoder-marketplace": true, … },
  "hooks": {
    "Notification": [], "PermissionDenied": [], "PermissionRequest": [],
    "PostToolUse": [], "PostToolUseFailure": [], "PreToolUse": [],
    "SessionEnd": [], "SessionStart": [], "Stop": [], "UserPromptSubmit": []
  }
}
```

本机所有 hooks 数组为空。事件名与 Claude Code 几乎一一对应（多出 PermissionRequest/PermissionDenied/PostToolUseFailure）。

## 将来深查清单

1. hooks 条目 schema（是否 `{"matcher","hooks":[{"type","command","timeout"}]}` Claude 形态；type 是 command 还是 process；timeout 单位）。
2. PreToolUse payload 字段与裁决协议（exit code？stdout JSON？`hookSpecificOutput`？）——在 `D:\Program Files\Qoder\resources\` 的 asar/已解包代码里 grep "PreToolUse"/"hookSpecificOutput"/"permissionDecision"，或 WebSearch 官方文档。
3. **PermissionRequest / PermissionDenied 语义**：若 hook 能自动响应权限请求，则 Qoder 可能同样支持"守卫委托宿主权限系统"形态（同 ADR-0011 思路）。
4. 工具注册名（Bash/Read/Write/Edit 还是别名）。
5. Windows 下 hook command 执行方式（shell？直接 spawn？）。
6. IDE 版本与 hooks 最低版本要求。
