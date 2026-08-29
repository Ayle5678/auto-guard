# 0009 — Guard TUI：全屏交互管理控制台（auto-guard-tui）

## 背景

非 DSH 宿主（zcode / claude / opencode / qoder / pi）没有 DSH 那样的设置 UI：用户管理守卫只能靠拼 `auto-guard …` 命令行。参考 [ccstatusline](https://github.com/sirmalloc/ccstatusline)（React/Ink 全屏 TUI、powerline 头、实时预览、守卫式危险操作确认）的体验标准，给 auto-guard 做一个**全屏交互管理控制台**：

- 覆盖**当前全部命令行操作**（安装器 + guard/set/examine/optimize 四组），另加 `:` 命令模式作为全命令保底；
- 主要面向宿主为 DSH 之外 agent 工具的用户（人类操作者）；DSH 用户想用也可以（同一命令面）；
- 双语（zh/en，ADR-0011 四层解析）；
- Windows 纪律沿用（自然退出、TTY 检查、退出码 0/2）。

## 命令面清单（覆盖目标 = 本清单的 100%）

安装器（`runInstallerCommand`，在 config-root 解析之前运行）：

| 命令 | 行为 |
|---|---|
| `init [--host …] [--yes] [--lang zh\|en] [--update-rules\|--skip-rules] [--banner]` | 检测宿主 → 多选 → 计划/差异预览 → 确认 → 备份 → 写入 → 验证；规则文件更新是显式选择（ADR-0013） |
| `list` | 每宿主检测证据 + 集成状态 + 下一步 |
| `remove [--host …]` | 有备份恢复备份，无备份结构性移除；数据根保留 |

管理四组（`runCli`，`--config-root` 显式传入）：

| 组 | 动作 |
|---|---|
| `guard` | `on` `off` `status`（单根视图 + 聚合视图）`recent [n]` `stats` `report [days]` `ping` |
| `set` | `set-key`（三步向导）`show-key` `clear-key` `set-api base <url>\|model <id>\|reset` `lang <zh\|en>` `history on\|off` `reload` |
| `examine` | `on` `off` `status` `clear-old` `clear-all` |
| `optimize` | `status` `analyze` `list` `rollback` |

> **实现差异（建票时发现，本 spec 只记录不修）**：统一 CLI（packages/cli `shell.ts`）的 `set set-key` 目前**无条件**打印 needs-TTY 并退出 2，与 `docs/cli.md` 声称的三步向导不符（向导真身只在 host-zcode 的旧 `cli.ts` 里）。TUI 不复用这条死路，而是按向导语义自己实现（见下），统一 CLI 的修复不在本 spec 范围。

## 产品形态

包 `@auto-guard/tui`（`packages/tui`），bin `auto-guard-tui`，零运行时依赖（ADR-0014）。全屏 alternate screen，帧 = 纯函数 `render(state) → string[]`。

```
┌─ 🛡 auto-guard ── ZCode ── ~/.zcode/auto-guard ── zh ── ● on ─┐  ← powerline 头
│ [1] 总览  [2] 守卫  [3] 审计  [4] 优化  [5] 密钥  [6] 安装  [7] 日志 [8] 帮助 │  ← 导航
├──────────────────────────────────────────────────┤
│                                                    │
│              当前屏内容（面板 / 列表 / 详情）          │
│                                                    │
├──────────────────────────────────────────────────┤
│ ↑↓ 选择 · Enter 执行 · : 命令 · r 刷新 · q 退出 │ ✅ guard on → 0 │  ← 键提示 + 回执
└──────────────────────────────────────────────────┘
```

### 屏清单

| 屏 | 内容与动作（→ 均为映射到左表命令的按钮/开关） |
|---|---|
| 总览 Dashboard | 每宿主一张状态卡（聚合 status 逻辑：seeded 全量 / unseeded 提示 / 缺席跳过）+ 当前根选择器 + `ping` + `r` 刷新 |
| 守卫 Guard | on/off 开关；status 详情面板；`recent n`（可滚）；`report [days]`（天数内联输入）；`ping`（busy spinner） |
| 审计 Examine | on/off；status；`clear-old`；`clear-all`（确认对话框） |
| 优化 Optimize | status；`analyze`（busy，需 examine on）；`list`（可滚）；`rollback`（确认，含备份信息） |
| 密钥 Set | `show-key`；`set-key` 三步向导（base → model → key 掩码输入；校验同 zcode 向导：base 须 http(s)、key ≥8 字符无空白；Enter 保留现值）；`clear-key`（确认）；`set-api base/model/reset` 内联输入；`lang zh/en` 即切即生效（回执用新语言）；`history on/off`；`reload` 说明 |
| 安装 Installer | 检测证据多选（复用 `detectHosts`）→ 规则更新选择（update/skip，ADR-0013）→ 计划预览（`buildInitPlan` + `buildRuleUpdatePlan` 渲染）→ 确认后 apply（等价 `init --host … --yes …`，但确认在 TUI 侧完成）；`list` 集成状态；`remove`（确认，可多选） |
| 日志 Log | 所有 TUI 发起命令的回执流水（命令 + 退出码 + 输出，可滚）；`:` 命令模式入口回显 |
| 帮助 Help | 键位表 + 每屏动作 ↔ 等价 CLI 命令对照表 |

### 键位

`↑↓/jk` 移动 · `←→/hl` 或数字 `1-8` 切屏 · `Enter` 执行/进入 · `Space` 勾选 · `Esc` 返回/取消 · `:` 命令模式（任意 argv，空格分割，经 `runCli`/`runInstallerCommand` 执行，回执进日志）· `r` 刷新当前屏 · `g/G` 滚动首/尾 · `q` 退出 · `Ctrl+C` 立即退出（退出前恢复终端）。

### 安全与纪律

- **危险操作守卫式确认**（ccstatusline 模式）：`clear-all`、`clear-key`、`rollback`、`remove`、init apply 必须过确认对话框；Esc 取消。
- **密钥不落 argv、不落日志**：set-key 向导掩码输入；日志面板对 `set set-key` 类回执只显示脱敏 `maskKey` 结果。
- **单一事实源**：所有管理动作经 `runCli(argv + 显式 --config-root)`，所有安装器动作经 `runInstallerCommand`；TUI 不重写任何操作语义。结构化读（状态卡、预览）直接调 core/cli 导出的读函数。
- **非 TTY / `TERM=dumb` / 管道**：拒绝启动，打印等价 CLI 命令提示，退出码 2（fail-closed 一致）。`NO_COLOR` 尊重（无色仍可运行）。
- **退出纪律**：alt screen 退出 + raw mode 复位 + `process.on('exit')` 兜底恢复；`process.exitCode` 自然退出（沿用 Windows libuv 纪律；reviewer 传输层已是 one-shot，无 keep-alive 悬挂）。
- **语言**：TUI 铬件双语，按 ADR-0011 四层解析（`AUTO_GUARD_LANG` > 当前根 `config.lang` > 机器默认 > zh）；`set lang` 后下一帧即换。
- **运行环境**：与仓库现状一致（Node ≥ 23.6 的 type-stripping 运行时；engines 字段照抄 cli 的 `>=20` 声明）；终端需 VT 支持（Windows Terminal / Git Bash / ConEmu / mintty / 常见 SSH 均可，老 conhost 需系统开启 VT）。

## 边界（不要动的）

- **core 与各 host 包**：零改动。`packages/cli` 只允许**加 exports 映射**（让 tui 深引 `shell.ts` / `status-store.ts` / `installer/*`），不动任何逻辑。
- 统一 CLI `set set-key` 的修复（文档-实现不一致）**不在本票**，只在此记录。
- 不做实时裁决流（TUI 不是 hook，不拦截决策）；不做 ccstatusline 级别的主题/渐变/字体配置（v1 固定一套好看的）；不做鼠标支持。
- 不新增任何运行时依赖（ADR-0002 精神延伸到 tui 包，见 ADR-0014）。
- 安装器 Profile / 检测 / 计划逻辑不改，TUI 只编排。

## 验收

- [ ] 上述命令面清单中**每个命令**都能从 TUI 完成（专属控件 或 `:` 命令模式），并有回执（退出码 + 输出）进日志屏
- [ ] 非 TTY 启动被拒（exit 2 + 提示）；q / Ctrl+C / Esc-Esc 均能干净退出并恢复终端
- [ ] set-key 向导：掩码输入、Enter 保留现值、非法输入拒绝、保存后 `show-key` 可见、日志只有脱敏回显
- [ ] 安装器：预览 → 确认 → apply 全程 TUI 内完成；remove 有确认；`list` 状态可见
- [ ] 中英文界面全屏切换无错位（CJK 宽度对齐）
- [ ] `pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿（新增 tui 包进 workspace）
- [ ] resize 终端不花屏（SIGWINCH + 轮询双保险）

## 票据

见 `issues/`（01–08，tracer-bullet 顺序，`Blocked by:` 标注）。接手信息见 `handoff.md`。
