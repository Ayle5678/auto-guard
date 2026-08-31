# 02 — CLI `guard ask` 裁决面：list / allow / deny --reason 写会话记忆

**What to build:** 用户运行 `auto-guard guard ask list` 看到全部待裁决记录（序号、命令原文单行、风险、时间（含日期）、来源工作区；空表有明确文案）；`allow <n>` 让完全相同的命令本会话静默放行；`deny <n> [--reason <text>]` 让完全相同的命令本会话拒绝且理由送达模型上下文。裁决写入对应会话的会话缓存（经共享 `sessionMemoryEntry`，键与四态记忆写入键全等，会话级有效、随会话目录 24h 剪枝消亡）；目标记录已消失时非零退出并明确报错；输出走双语消息目录。三个 hook 宿主的 CLI 均获得该命令组（对 pi/codex 无害的旁路视图）。

**Blocked by:** 01（裁决对象是 01 落盘的记录，写入复用其键构建）

**Status:** done

- [x] list 展示多会话记录；空表/无根均有友好输出
- [x] deny --reason 后完全相同的命令不再弹窗，理由作为拒绝理由送达模型上下文（zcode e2e：同调用第二次直接 deny 且带理由；core ask-escape spec 钉死 source=session-cache）
- [x] allow 后完全相同的命令本会话静默放行
- [x] stale 条目非零退出 + 明确报错；不误写其他会话
- [x] 包级 typecheck + test 全绿；与 01 联动端到端验证（guard-ask-cli.spec：ask → CLI 拒绝附理由 → 同调用变 deny）

## Comments

- 2026-08-31: 建票 —— once 两态由宿主弹窗覆盖，CLI 只做 session 级（ADR-0019 决策 2）。
- 2026-08-31: done。落点：host-runtime `cli.ts` `guard ask` 组 + 目录双 key（拒绝回执按有无理由分 `askResolvedDeny` / `askResolvedDenyWithReason`，标点归目录——评审 ADR-0011 修订）。契约套件全宿主行 + zcode 端到端各一节。
