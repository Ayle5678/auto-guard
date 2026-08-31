# zcode ask 逃生舱：宿主弹窗外接四态记忆（pending ask 落盘 + CLI 裁决），弹窗本身不动

> 起因：真实使用中，zcode 宿主对守卫 ask 只渲染三个按钮（同意 / 本会话都同意 / 拒绝），既没有「本会话都拒绝」，也没有附理由说明需求的输入框。grill-log Q11 曾裁决「zcode 不补四态」——本决策以窄口径重开：**宿主弹窗内的体验一个字都不改**（也改不了），四态记忆落在弹窗**外**的守卫自有通道上。

## 约束（为什么弹窗本身不可扩展）

- 三个按钮由 zcode 宿主权限系统渲染。auto-guard 以 PreToolUse 进程 hook 接入，出线协议是严格 zod schema（`wire.ts` 已对 ZCode client bundle 核实）：stdout 只允许 `hookSpecificOutput{hookEventName, permissionDecision, permissionDecisionReason, additionalContext}`。没有「自定义选项」「文本输入」字段。
- hook 是无 TTY 子进程（`askStyle: 'native'`、`hasUI: false`），画不出自己的交互界面。
- 可控面只有三样：① ask/deny 的 `permissionDecisionReason` 文案（ask 显示在确认框、deny 进模型上下文）；② 裁决落盘后的会话缓存（下一条完全相同的命令不再问）；③ 守卫自有的 CLI/TUI。

## 决策

1. **ask 出线时旁路落盘一条 pending ask 记录**（per session 目录，键 = `buildSessionKey(session, workspace, command)`，与 `rememberAsk` 写入键一致；同键 upsert + 触碰 `askedAt`，防宿主会话放行后的重复污染）。出线协议不变——宿主弹窗照旧三按钮，pending 只是旁路记录，零行为风险。
2. **新增 CLI `guard ask list / allow <n> / deny <n> [--reason]`**（语义即四态中的 allow-session / deny-session；once 两态宿主弹窗已覆盖，CLI 不重复）。resolve 复用 `rememberAsk` 的会话缓存写入语义（`expiresAt = MAX_SAFE_INTEGER`，随会话目录 24h 剪枝自然消亡，「本会话」保真）。deny 命中的后续调用以用户输入的 reason 作为 `permissionDecisionReason` 进模型上下文——这就是 zcode 下「向 agent 说明需求」的落地闭环。
3. **ask reason 文末追加一行逃生舱提示**（双语目录消息，仅 `askStyle: 'native'` 宿主追加）：告知用户「本会话记住 / 附理由」走 `guard ask`，「说明需求」可在选拒绝后直接在对话里进行。
4. **ask 出线时经 `additionalContext` 预注射模型指引**（同一 native 门控）：ZCode 官方 hook 文档已核实 `additionalContext` 注入对话、且与 PreToolUse permission decision 共存。内容为「守卫已请求人工确认；用户拒绝并给出理由时按理由调整、不要原样重试；用户表示本会话拒绝此类命令时，可运行 `guard ask deny --reason` 记入会话记忆」。这是模型侧行为的塑形，不是用户输入口——用户打字仍走对话本身。
5. **自放行只给只读与只降权路径**：出厂规则放行 `auto-guard guard ask list`（只读）与 `auto-guard guard ask deny *`（只写入本会话拒绝，能力只减不增）；`allow`、`guard on/off` 及其余管理命令**不**放行——被守卫的代理不能给自己发许可或关闸。`node <路径>/auto-guard.js …` 形态同样不放行：`*` 跨段匹配会把任意脚本路径变成代码执行洞，此类调用保持宿主一次确认。

## Considered Options

- 给宿主弹窗加第四个按钮 / 文本框：协议不允许，方案不存在（见约束）。
- 重复 ask 自动升级为 deny（「问过就拒」）：守卫看不见宿主弹窗结果，无法区分「拒绝过」与「同意过一次」，会误杀合法的 once 放行流。拒绝。
- 会话级拒绝改为写 rules.json 持久规则：跨会话语义，超出「本会话」诉求；rules.json 是用户所有物（ADR-0008/0013），由运行中命令隐式写入违背显式性。持久规则管理是独立特性，不入本决策。
- 把 ask 整体改为 deny（codex `headlessFallback: 'deny'` 路线）：丢掉一键同意，宿主弹窗三按钮中的两个作废，净体验倒退。拒绝。
- resolve 键用命令形状（shape）而非原文：与 Pi 四态 `rememberAsk` 既有语义（全文键）不一致，两套记忆语义漂移。v1 全文键，形状级匹配列为后续研究方向（SPEC 0007 近邻匹配先例可参照）。
- 用 `additionalContext` 替代输入框：方向不通——它是 hook→模型的注入通道，用户无法借此输入任何文字。采纳为其本来的用途（决策 4 的预注射塑形）。

## Consequences

- 「本会话都拒绝」与「附理由拒绝」在 zcode 可用，但需要一次 CLI 操作——弹窗内永远只有三按钮，这是宿主约束下的最终形态，文档如实写明。
- pending ask 记录与文案增强只对**默认 hookSpecificOutput 方言**的 native 宿主生效（zcode / claude / qoder，`hasAskEscapeHatch`）；pi（four-state，进程内解决）、codex（ask→deny 翻译）、opencode（自有 verdict wire）逐字节不变。
- 文件工具获得会话记忆查询（`decideFile` 在敏感路径门之前查会话缓存，键 = 文件路径）——否则对敏感写入的裁决永远无法生效。这是通用管线语义而非宿主分支：pi 四态至今只对 llm 来源的 ask 提供对话框（`canRememberAsk`），从未写过文件路径条目，故 pi 实际行为不变（ADR-0007 纪律：查缓存是通用层，写不写是宿主的选择）。
- `guard ask` 子命令进入共享 CLI 面（host-runtime `createCliMain`），全部 hook 宿主可见——对 pi/codex 是无害的旁路视图。
- 会话缓存经此通道获得的 allow/deny 与宿主「本会话都同意」（宿主自有 allowlist）是两层，互不读写（ADR-0015 已接受宿主层放行绕过守卫）。
