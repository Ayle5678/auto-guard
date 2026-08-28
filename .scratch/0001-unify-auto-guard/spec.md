# SPEC 0001 — unify-auto-guard：三宿主合并为单仓多适配守卫

> Effort: 0001-unify-auto-guard
> Status: ready-for-agent
> 前置文档: [CONTEXT.md](../../../CONTEXT.md) · [docs/adr/](../../../docs/adr/) · [docs/grill-log.md](../../../docs/grill-log.md)
> 关联前代: dsh-auto-guard 0.2.0 · pi-auto-guard 0.1.3 · zcode-auto-guard 0.1.0（含 ADR 集各一套）

## Problem Statement

同一个"命令审查守卫"以复制移植方式存在三份（dsh-auto-guard → pi-auto-guard → zcode-auto-guard，逐代复制核心 + 换适配层）。zcode ADR-0001 已承认复制模式的核心同步税；dsh 与 zcode 近期各自新增功能（SQLCipher 审计、决策历史、加密 key 向导等），三份核心开始实质分叉。任何一次管线改进现在要做三遍。

## Solution

pnpm workspace 单仓：`@auto-guard/core`（零宿主依赖裁决引擎）+ 三个薄适配层 + `packages/cli`（统一管理 CLI + 安装器）。宿主差异经 GuardDeps 注入与 HostCapabilities 声明表达（ADR-0002/0007）；配置根继续按宿主隔离、路径不变、零用户迁移（ADR-0003）。细节按各库最新取齐（见 Implementation Decisions）。

## 宿主差异矩阵（合并后的目标态）

| 维度 | host-dsh | host-pi | host-zcode |
|---|---|---|---|
| 集成事件 | `tools/pre-execute` + guard 单调守卫 | `tool_call` + `user_bash` | PreToolUse hook（一次一进程）+ SessionStart |
| 决策协议 | PreToolDecision deny/ask + next() | `{block,reason}` / input 改写 | stdout JSON permissionDecision；allow=静默 |
| ask 风格 | 宿主一次性审批（one-shot） | ctx.ui 四态（four-state） | 委托原生确认框（native） |
| 启停 | 权限预设选择（唯一开关） | `/guard on\|off` + config.enabled | config.enabled（`/guard off` 永远有效） |
| 会话态 | 内存 | 内存 | 磁盘（sessions/<sid>/） |
| 通知 | page 事件 / context 注入 | ctx.ui.notify / sendMessage | 决策历史拉式（guard recent） |
| 配置挂载 | settings namespace + secret role | config.json（key 走加密层） | config.json + api-key.json 加密 |
| 命令面 | 无 slash 命令；设置 UI + Typert | /guard /guard-set /guard-examine /guard-optimize | commands/*.md 教模型调 CLI |
| 打包 | dsh 插件（client.js + typert + cordis.patch.yml） | pi extensions（jiti 直跑 TS） | 插件清单 + hooks.json + dist 构建 |
| 审计实现 | SQLCipher | SQLCipher（降级 Light） | Light（node:sqlite + 字段加密） |

## User Stories

1. 作为任一宿主的用户，我升级到统一包后配置、规则、缓存、审计、学习规则原地续用（配置根路径不变）。
2. 作为守卫使用者，三个宿主上裁决顺序、规则语义、缓存 TTL、学习规则行为完全一致。
3. 作为 pi 用户，我的 API key 自动升级为加密存储，明文遗留字段只读不回写。
4. 作为 zcode 用户，我获得与 dsh/pi 相同的 SQLCipher 级别可选加密（若接受 optionalDependency）或继续零依赖轻量加密。
5. 作为 dsh 用户，设置 UI 与 Typert remote 的每个维护按钮继续工作，只是底层换成共享 core 操作。
6. 作为开发者，修一个管线 bug 只改 core 一处，三宿主测试全绿即证明三宿主同时修复。
7. 作为开发者，新增一个宿主只需新建适配层包 + 能力声明，core 零改动。

## Implementation Decisions

- **包结构**：`packages/{core,host-dsh,host-pi,host-zcode,cli}`；npm 组织 `@auto-guard/*`；CLI bin `auto-guard`；TS ESM；vitest；Node ≥ 20。
- **core 文件来源**：以 zcode 版（注入化最彻底）20 个核心模块为基底，吸收 dsh 独有能力（notify-policy/notify-text 细分、Remove-Item 运行时目录判定、`[删除理由]` 会话扫描、settings 可用性回退、typert 无关部分）；dsh 版 newer 的模块以 dsh 为准（audit SQLCipher、template-cache 加载期去重）。
- **细节按最新**：timeoutMs 默认 **8000**；学习规则 **cacheable-only** + 加载期过滤去重；管道叶子确定性放行；shell 敏感路径 token 级守卫；决策历史（环形 200 行 + hitDetail）；key 水合链；通知默认 allow=page、deny/ask=context；headlessMode 字段仅 pi/dsh 能力层使用，zcode 不暴露。
- **RulesFile / GuardConfig**：单一超集 schema（zcode 38 键为基底 + dsh 的 provider/reasoningEffort/fallbackProvider/notifyAllow/Deny/Ask 三通道细化）。defaults/rules.json 取三库并集、人工复审去重，放 `packages/core/defaults/rules.json`，各宿主播种到各自配置根。
- **core 禁止项**：import 任何 `@deepseek-ai/*`、`@earendil-works/*`、zcode SDK；出现宿主名分支。审计的 `better-sqlite3-multiple-ciphers` 为 optionalDependency（ADR-0005）。
- **打包**：dsh 保留 client.js 浏览器半区与 typert manifest（host-dsh 内）；pi 入口继续 jiti 直跑 TS；zcode 继续预构建 dist（plugin.json + hooks.json + commands/*.md 归 host-zcode，修复 guard-set.md 中硬编码的绝对路径为 `${ZCODE_PLUGIN_ROOT}`）。
- **版本**：统一包起始 0.3.0；三旧仓库 README 顶部加指向 + archived。

## Testing Decisions

- 最高 seam 不变：`GuardService.decide()`（前代 60+ spec 文件的断言全部迁移到 core）。
- 会话态双实现各自 spec；磁盘实现沿用 zcode 的 session-store/persist-map spec。
- 每适配层一个协议 spec：dsh（PreToolDecision 映射）、pi（block/input 改写/user_bash）、zcode（stdin/stdout JSON、fail-closed 阶梯、allow 静默）。
- key 水合链、审计双实现、安装器 profile 各自 spec。

## Out of Scope

- 安装器交互细节（SPEC 0002-installer）。
- 新增第四宿主（架构为其留位，但本文不做）。
- 跨宿主数据共享桥（ADR-0003 明确只留 opt-in 未来位）。
- 三旧仓库的删除/归档执行（由维护者手动操作，本文只产迁移指南）。

## Further Notes

- 前代 spec 习惯（.scratch/NNNN-slug + issues/ + Status 行）原样沿用。
- dsh `.scratch/0003` 曾把"砍 slash 命令"定为决策，合并时该决策继续只在 dsh 生效（ADR-0007 能力模型保证）。
- 相关 ADR：0001（monorepo）、0002（core seam）、0003（配置根）、0004（会话态）、0005（审计）、0006（key）、0007（能力）、0009（CLI）。
