# ADR-0018 — Codex 宿主：hooks.json 通道 + 能力驱动的 ask→deny + 补丁面提取

- 状态：Accepted
- 日期：2026-08-30
- 关联：SPEC 0015；ADR-0002（core 零宿主依赖）、ADR-0003（每宿主配置根）、ADR-0007（能力模型）、ADR-0008（profile 数据驱动）、ADR-0011（语言四层）、ADR-0016（宿主描述符运行时）

## 背景

OpenAI Codex CLI（本机 codex-cli 0.151.0）提供了 hooks 扩展框架（learn.chatgpt.com/docs/hooks，官方文档 + 二进制 strings 交叉核实）。接入它作为第七个宿主时，有三处与既有 hook 宿主（zcode / claude / qoder）不同，需要决策：

1. **ask 的宿主语义**：codex 的 PreToolUse 协议**能解析** `permissionDecision:"ask"` 但**不支持**——hook 标记失败、工具调用继续执行（fail-open，官方文档明示）。
2. **文件编辑的载荷形态**：codex 没有字段式 Write/Edit 工具，文件编辑走 `apply_patch`（别名 `Edit`/`Write`），整个 V4A 补丁文本塞在 `tool_input.command`，一个补丁可同时改多个文件。
3. **集成通道**：hooks 可以写在 config.toml 内联 `[hooks]`（TOML）或独立 `~/.codex/hooks.json`（JSON）；两层会合并且命中全执行，同层双定义会启动告警。安装器目前只有 json-merge 写入器（ADR-0008），没有 TOML 合并器。

## 决策

### 1. ask → deny，由能力声明驱动、落在默认 wire（运行时行为）

- codex 一旦发出 `"ask"`，结果不是"宿主弹确认框"而是"hook 失败 + 调用继续"——**fail-open，绝不可发**。
- 能力声明取 `askStyle: 'one-shot'` + `headlessFallback: 'deny'`（dsh 先例的语义：ask 不可能成为交互确认时，fail-closed 落拒绝）。这符合 ADR-0007 的本意：核心只产 ask，宿主声明 ask 的归宿。
- 翻译机制放**运行时默认 wire**（`createDefaultWire(capabilities)`）：`headlessFallback: 'deny'` 时，一切 ask 结果（含 fail-closed 阶梯的 unparseable / unreviewable / 审查器故障）渲染为 deny，理由 = 原 ask 理由 + 双语提示（catalog 新键 `askDeniedNoPrompt`：说明宿主无法弹确认、已按拒绝处理、出路是手动执行或加入 userConfirmed）。描述符保持纯数据（ADR-0016 纪律）；`wire` 槽的签名加了一个可选 `lang` 参数（加法，opencode wire 不受影响）。
- `headlessFallback: 'host'` 的宿主（zcode/claude/qoder）走原 `defaultWire`，行为逐字节不变。

### 2. 补丁面提取：`patchCommand` 数据槽 + `GuardRequest.paths`

- `ToolMapping` 增纯数据槽 `patchCommand?: string`（tool_input 中承载补丁文本的字段名）；extraction 解析 V4A 头部（`*** Add/Update/Delete File:` + `*** Move to:`）得全路径集，缺失文本或零头部 → unreviewable（fail-closed）。
- `GuardRequest` 增可选 `paths?: readonly string[]`（全路径集，`filePath` 仍为主路径 = 历史主体）；core `decideFile` 对全部路径过敏感路径门。**动机**：codex 单补丁常改多文件，只查首路径会让第二个文件里的 `.env` 漏网——而文件工具的唯一守卫就是敏感路径门。
- 内容纪律不变：decideFile 从不读内容，补丁正文永不出本机。

### 3. 集成通道 = 独立 hooks.json；allow = 静默；不接 PermissionRequest

- 安装器写 `~/.codex/hooks.json`（纯 array-append，无新 op kind），不碰 config.toml 内联 `[hooks]`——避免两层合并告警，也复用既有 json-merge 写入器（ADR-0008 门槛内）。matcher `^(Bash|apply_patch|Edit|Write)$`；timeout 90/30 秒（claude 先例）。
- **allow = 静默（exit 0）**：codex 的沙箱 / 审批流程照常，守卫只做加法（拦 deny、缓存、审计、学习），不代替宿主审批——与 zcode/claude 同位。`danger-full-access` 模式下宿主本不弹确认，守卫 deny 是唯一安全网。
- 不接 `PermissionRequest` hook（v1）：PreToolUse deny 已覆盖全量访问模式；审批层短路（缓存命中自动放行审批框）留作后续独立特性。
- **信任门是产品事实**：非托管 hook 首次运行前必须经 `/hooks` 人工信任（内容哈希制，未信任即静默跳过）。安装器把它列为 codex 专属 postInstall 警示（`codexTrustHint`），措辞点明"看似开启实则没跑"。
- 桌面 App（ChatGPT.app 内置 codex）与 CLI 共享 `~/.codex` 与同一 hook 运行时（已核对内置二进制含完整 hook_runtime），同一 hooks.json 覆盖 App 会话；App 内信任流未实机验证，文档如实标注。

## 后果

- 第七个宿主以"一个包 + 一条 profile + 两处数据槽扩展 + 一处能力驱动的 wire 工厂"落地；core 仅 GuardRequest 加可选字段 + decideFile 遍历路径集，既有宿主零行为变化（契约套件参数化 fail-closed 渲染，'deny' 宿主断言 deny）。
- codex 用户失去 ask 的交互确认（四态/原生框都不存在）——这是宿主协议的硬约束，不是产品选择；理由文案给出路（手动执行 / userConfirmed），`guard recent` 可查每次裁决。
- TOML 内联通道与 PermissionRequest 短路是有意的非目标；宿主协议若后续原生支持 ask，本决策应重开。
