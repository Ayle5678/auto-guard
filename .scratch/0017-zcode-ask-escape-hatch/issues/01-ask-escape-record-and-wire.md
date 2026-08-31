# 01 — ask 出线旁路记录与出线增强（pending ask + 提示文案 + 模型预注射）

**What to build:** zcode（及 claude/qoder）守卫 ask 时：宿主弹窗照旧三按钮、出线协议除两处增强外逐字节不变——① 原因文案末尾多一行双语逃生舱提示（本会话记住/附理由走 `guard ask`；说明需求可在拒绝后直接对话）；② ask 结果附带模型预注射上下文（用户拒绝并给出理由时按理由调整、不要原样重试；用户表示本会话拒绝时守卫 CLI 可记入会话记忆）。同时每次 ask 旁路落盘一条 pending ask 记录到该会话目录：完全相同的命令重复 ask 只留一条（upsert + 触碰时间戳），写失败静默不影响出线。pi / codex（及 opencode）宿主行为零变化。

**范围澄清（评审后修订）**：提示与预注射只挂在**可解析**的 ask 上——守卫拿到 guardable 请求且记录确实落盘才追加；unreviewable（tool_input 不可读）与 fail-closed 初始化失败类 ask 没有可解析对象，不落盘也不加提示（提示指向空列表是误导）。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] ask 出线字节：reason 文末含提示行；ask 结果含 additionalContext；allow/deny 结果不含（契约套件全宿主行验证）
- [x] 会话目录出现 pending ask 记录；完全相同命令的重复 ask upsert 为一条且时间戳更新
- [x] 落盘失败时 ask 出线与改动前一致（旁路静默；guard-ask-cli.spec 静默失败用例）
- [x] pi / codex / opencode 宿主：无提示行、无 additionalContext、无落盘（契约测试钉死）
- [x] 包级 typecheck + test 全绿

## Comments

- 2026-08-31: 建票 —— 用户实测反馈：宿主弹窗只有三按钮，缺「本会话都拒绝」与附理由入口；设计见 ADR-0019。
- 2026-08-31: done。核心落点：core `session-store.ts` pending-ask 原语、`hook-cli.ts` 旁路记录 + `hasAskEscapeHatch` 门控、wire ask-only `additionalContext`、目录消息 `askEscapeHint`/`askModelContext`。评审修订：提示仅在记录可解析且落盘成功时追加（unreviewable/fail-closed ask 不加）。
