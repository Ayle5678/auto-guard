# auto-guard（统一命令审查守卫）

面向 AI 编码 agent 的命令审查守卫：在宿主执行命令或读写文件之前，用分层静态规则、缓存、学习规则、审计历史与可选 LLM 审查给出 **allow / deny / ask** 裁决。一个核心裁决引擎 + 三个薄宿主适配层。

- **`@auto-guard/core`** — 零宿主依赖的裁决引擎（裁决管线、规则、缓存、key 水合、审计、历史层、学习规则、管理操作层）。
- **`@auto-guard/host-pi`** — Pi Coding Agent 扩展（`tool_call` / `user_bash`，四态 ask）。
- **`@auto-guard/host-zcode`** — ZCode PreToolUse hook 插件（一次一进程、磁盘会话态、决策历史）。
- **`@auto-guard/host-dsh`** — DeepSeek Harness 插件（`tools/pre-execute`、权限预设开关、SQLCipher 审计、设置页 + Typert remote）。
- **`@auto-guard/cli`** — 统一 `auto-guard` 管理 CLI 与（SPEC 0002）安装器。

本 monorepo 合并三个复制移植前代：`dsh-auto-guard` 0.2.0 → `pi-auto-guard` 0.1.3 → `zcode-auto-guard` 0.1.0。跨宿主修复一次提交同步全部宿主；各宿主保留原生打包与分发渠道（差异见 [differences](docs/differences.md)）。

## 宿主对照表

| 维度 | host-dsh | host-pi | host-zcode |
|---|---|---|---|
| 集成事件 | `tools/pre-execute` + 单调守卫 | `tool_call` + `user_bash` | PreToolUse hook（一次一进程）+ SessionStart |
| 决策协议 | PreToolDecision deny/ask + `next()` | `{block, reason}` / input 改写 | stdout JSON `permissionDecision`；allow=静默 |
| ask 风格 | 宿主一次性审批 | 四态确认框 | 委托原生权限确认框 |
| 启停 | 权限预设（`auto-guard`）——唯一开关 | `/guard on\|off` + `config.enabled` | `config.enabled`（`/guard off` 永远有效） |
| 会话态 | 内存 | 内存 | 磁盘（`sessions/<sid>/`） |
| 通知 | page 事件 / context 注入 | `ctx.ui.notify` / `sendMessage` | 拉式决策历史（`guard recent`） |
| 配置根 | `~/.dsh/auto-guard/` | `~/.pi/auto-guard/` | `~/.zcode/auto-guard/` |
| 命令面 | 设置 UI + Typert remote（无 slash 命令） | `/guard` `/guard-set` `/guard-examine` `/guard-optimize` | `commands/*.md` 教模型调 CLI |
| 打包 | dsh 插件（client.js + typert + cordis.patch.yml） | pi extensions（jiti 直跑 TS） | 插件清单 + hooks.json + 预构建 dist |
| 审计实现 | SQLCipher（全库加密） | SQLCipher（不可用时降级 Light） | Light（node:sqlite + 字段级 AES-GCM） |

## 安装

统一安装器三分钟上手（Node ≥ 20、零外部依赖）：

```bash
auto-guard init        # 检测本机宿主、复选框勾选、写入集成
# …或非交互：auto-guard init --host pi,zcode --yes
```

每次写入前展示 diff 摘要、强制备份为 `*.auto-guard.bak`、写后校验——重复 `init` 幂等。装完在**新会话**中验证（ZCode hooks 无热重载，必须新开 ZCode 会话）：`auto-guard guard status`。`auto-guard list` 查看检测证据与接入状态；`auto-guard remove [--host …]` 完整卸载（还原备份；`~/.<host>/auto-guard/` 数据保留）。详见[使用手册](docs/usage.md) · [CLI 指南](docs/cli.md) · [故障排查](docs/troubleshooting.md)。

各宿主原生渠道继续可用、与安装器并存——本来就手工管理某宿主插件时用原生渠道即可：

- **ZCode**：安装插件（`packages/host-zcode`，manifest + hooks；`dist/` 预构建）。
- **Pi**：注册扩展（`packages/host-pi/package.json` → `"pi": {"extensions": ["./src/index.ts"]}`；jiti 直跑 TS）。
- **DSH**：安装插件（`packages/host-dsh`）；在聊天栏选择 `auto-guard` 权限预设即开启。

新增第四个宿主 = 一条 profile + 一个适配层包，不改安装器逻辑（[接入指南](docs/new-host.md)）。

## 配置

单一超集 schema；各宿主把同一套键播种到各自配置根（路径与前代一致——升级零迁移）。关键默认值（`timeoutMs` 8000；通知路由 allow=page、deny=ask=context；TTL low 30 天 / medium 7 天 / high 永不）：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（pi/zcode）；dsh 用权限预设 |
| `apiBase` | `https://api.deepseek.com` | OpenAI 兼容审查端点（dsh：空 = provider 路由） |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 环境变量优先于本地存储 |
| `model` / `fallbackModel` | `deepseek-v4-flash` | 审查模型与回退模型 |
| `timeoutMs` | `8000` | 单次请求预算；超时 fail-closed |
| `onTimeout` | `deny` | 服务级兜底策略 |
| `headlessMode` | `deny` | 无 UI 时 ask 的落点（pi/dsh 能力层） |
| `notifyAllow` / `notifyDeny` / `notifyAsk` | `page` / `context` / `context` | 按裁决种类路由 |
| `lowRiskTtlDays` / `mediumRiskTtlDays` | `30` / `7` | 持久缓存 TTL（high 风险永不缓存） |
| `sessionCacheSize` | `256` | 会话 LRU 容量 |
| `alwaysReviewCacheTtlMinutes` | `30` | 必审命令会话内放行的短 TTL |
| `fileTrackerDefault` / `fileTrackerWindowSec` | `ask` / `5` | 写后执行追踪器 |
| `examineEnabled` | `false` | 实验性审计日志（默认关闭） |
| `historyEnabled` / `historyDays` | `false` / `60` | 基于审计库的运行时历史层 |
| `autoAnalyzeEnabled` / 各阈值 | `false` / 保守 | 学习 cacheable 规则生成 |
| dsh 特有 | — | `provider`、`reasoningEffort`、`fallbackProvider`、`apiKeyMasked`、`auditPassword`（secret role） |

路径型键（`rulesPath`、`defaultRulesPath`、`cachePath`、`auditDbPath`、`learnedRulesPath`、`learnedBackupPath`、`analyzeStatePath`、`templateCachePath`）默认均落在宿主配置根内。

API key 解析顺序：**环境变量 → 加密存储（`api-key.json`，AES-256-GCM 机器绑定）→ 遗留明文字段（只读，永不回写）**。

## 从 dsh-auto-guard / pi-auto-guard / zcode-auto-guard 迁移

1. 在宿主中卸载旧插件/扩展。
2. 用同一宿主渠道安装统一包（或安装器）。
3. 完事。配置根、文件名、schema 键全部不变：规则、缓存、学习规则、审计数据原地续用。行为差异逐项见 [differences](docs/differences.md)。

## 开发

```bash
pnpm install
pnpm -r typecheck && pnpm -r test   # 各包 vitest 套件
pnpm smoke                          # 各宿主冒烟脚本
```

`GuardService.decide(GuardRequest)` 是唯一测试 seam；`packages/conformance` 固定三种 bootstrap 风格下裁决语义完全一致。

License: MIT。
