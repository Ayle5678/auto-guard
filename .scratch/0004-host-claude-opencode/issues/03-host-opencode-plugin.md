# 03 — host-opencode 插件（permission.ask 驱动 + spawn 进程模型）

What to build:
- `packages/host-opencode/`（@auto-guard/host-opencode；`@opencode-ai/plugin` 仅 devDependencies 类型引用）：
  - 插件入口 `plugin.ts`（`export const AutoGuard: Plugin`）：
    - `permission.ask` hook：input `Permission`（`{type, pattern?, title, metadata, sessionID, callID?}`，见 research/opencode-plugin-api.md）→ spawn node hook-cli → status 映射：allow → `output.status = 'allow'`；deny → `'deny'`；guard ask → **不改写**（落 opencode 原生 TUI：一次/本会话总是/拒绝）。
    - permission 配置键 → GuardRequest 工种类映射：bash→bash；edit（宿主侧覆盖 write/patch）→edit；read→read。`Permission.metadata` 实际键名实现期核实，不足处用 `tool.execute.before`（先于 ask 触发，按 callID 暂存 args）兜底。
    - 插件内 catch-all：异常**不得 throw**（宿主把 throw 当工具错误而非权限裁决）；status 原样 = 落宿主 TUI 兜底。
  - `hook-cli.ts` + `opencode-adapter.ts`：进程 hook 形态与 host-claude 同构（stdin JSON `{tool_name, tool_input, session_id, cwd}` → GuardService → stdout `{status, reason}`）；首次调用惰性 provisioning（配置根 `~/.config/opencode/auto-guard/`）。
  - `opencode-capabilities.ts`：`askStyle: 'native'` + `headlessFallback: 'host'`。
- spawn 用 node 绝对路径 + 正斜杠路径参数（跨 Windows shell=False 语义）；spawn 失败视作 guard 不可用，status 原样落 TUI。

Blocked by: —
Status: done

Acceptance:
- [x] 单测：Permission payload → GuardRequest；status 三态映射；插件异常不 throw
- [x] hook-cli 集成冒烟：stdin 样例 → stdout 决策（smoke-opencode.mjs 走完整插件链路，4/4 PASS）
- [ ] 真机冒烟（opencode 启动器修复后）：deny 样例命令被拦、allow 用户无感、ask 落 TUI——启动器已修复（postinstall 重跑，opencode --version 正常）；交互 TUI 验证待人工

## 实施期偏差说明（2026-08-29）

- **机制修订（ADR-0011 修订）**：permission.ask hook 在 1.18.x 从不派发（编译产物核实，同 issue #7006 结论）；实际通道为 `event` hook 监听 `permission.asked` 总线事件 + `client.permission.reply`（allow→once / deny→reject+理由 / ask→不答复落 TUI）。permission.ask hook 实现保留作前向兼容。tool.execute.before 兜底不再需要（metadata 键名已核实：bash={command}、edit={filepath,diff}、read={} 路径在 patterns）。
- **类型引用**：未加 `@opencode-ai/plugin` devDependency，改为零依赖结构类型（`opencode-plugin-types.ts`，host-pi 的 pi-sdk.d.ts 先例）——避免为纯类型引入网络安装。
- **node 绝对路径**：实际为 `AUTO_GUARD_NODE` 环境变量覆盖、缺省 PATH 解析 `node`（shell:false；Windows CreateProcess 自动补 .exe）；绝对路径无法跨机器硬编码，环境变量提供同等确定性。
