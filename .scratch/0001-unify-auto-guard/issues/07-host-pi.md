# 07 — host-pi 适配层

What to build:
- `packages/host-pi`：pi 扩展入口（`tool_call`/`user_bash`/`session_start`/`session_shutdown` 接线）+ adapter（Pi 工具调用形状 → GuardRequest）。
- ask：`ctx.ui.select` 四态（能力声明 askStyle=four-state）、`ctx.hasUI + headlessMode` fail-closed。
- 通知：`ctx.ui.notify` + `sendMessage` 通道；状态栏四态图标。
- slash 命令：/guard、/guard-set、/guard-examine、/guard-optimize 全部改调 core 操作层。
- 配置根 `~/.pi/auto-guard/`；key 挂加密层（ADR-0006）；审计走 SqlcipherAuditStore（optionalDependency 可用时）。
- jiti 直跑 TS，package.json pi manifest `{"pi":{"extensions":["./src/index.ts"]}}`。

Blocked by: 06
Status: done

Acceptance:
- [x] pi 版现有 spec（除已上移 core 的）在 host-pi 全绿
- [x] 四态 ask、deny 重复确认、目录删除流程行为与 pi 0.1.3 一致
- [x] user_bash 拦截（operations 替换）仍有测试覆盖

## Comments

- 2026-08-28: done — entry + adapter + config root ~/.pi/auto-guard; four-state ask via capabilities; keys upgraded to encrypted store + hydration chain (legacy plaintext read-only); audit via createAuditStore (SQLCipher when optional dep available); slash commands call core ops; SDK typed via ambient shim (jiti resolves the real package at runtime)
