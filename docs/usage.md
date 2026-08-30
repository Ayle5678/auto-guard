# auto-guard 使用手册

auto-guard 是缓存式自动命令审查工具（Cached Auto Command Review）：在你的 AI 编码 agent 执行命令或读写文件**之前**，按静态规则、缓存、学习规则、审计历史和可选 LLM 审查给出 **allow / deny / ask** 裁决。本手册覆盖全部命令行用法；概念与架构见 [README](../README.zh-CN.md)，装不上/不生效见[故障排查](troubleshooting.md)。

---

## 1. 运行方式

三种等价入口（Node ≥ 22.18，实测下限；core 零运行时依赖，SQLCipher 审计库为可选原生依赖、缺失自动降级）：

```bash
# 1) npx（发布后）
npx @auto-guard/cli <命令>

# 2) 本仓库开发树（Node 22.18+ 可直跑 TS）
node packages/cli/src/auto-guard.ts <命令>

# 3) 构建产物
pnpm build && node packages/cli/dist/auto-guard.js <命令>
```

下文统一写 `auto-guard <命令>`。命令分两类：

| 类别 | 命令 | 何时用 |
|---|---|---|
| **安装器** | `init` `list` `remove` | 装守卫、看状态、卸守卫。不需要已有配置，裸机器可跑 |
| **管理命令** | `guard` `set` `examine` `optimize` | 守卫装好后的日常管理，需要定位到某个宿主的配置根 |

---

## 2. 安装器

### 2.1 `auto-guard init` — 交互式安装

```bash
auto-guard init
```

流程六步：

0. **头图**：交互终端下先打印青蓝紫渐变块状大字；tagline 固定四行——包名版本、中文名、英文名、宿主清单（名字两行天然双语，不随语言切换）。
1. **选语言**：双语提问「请选择语言 / Select language」，输入 `1` 中文（默认，回车即选）、`2` English；之后的所有提示跟随所选语言。脚本 / CI 可用 `--lang` 或环境变量 `AUTO_GUARD_LANG` 跳过提问（见 2.2 / 2.5）。
2. **扫描**：按各宿主特征（目录 / 标志文件 / PATH 上的可执行文件）检测本机已装的宿主。
3. **勾选**：复选框列表，已检测到的默认勾选；输入序号可切换，回车确认。手动勾选未检测到的宿主时会显示写入目标并要求二次确认（防误装）。
4. **预览 + 写入**：每宿主展示将执行的步骤和 diff 摘要 → 确认 → 备份原文件为 `*.auto-guard.bak` → 写入 → 读回校验。
5. **汇总**：装了什么、如何验证、如何卸载。

交互示例（dsh 与 zcode 已装、其余未装；TTY 下先进头图，tagline 固定中英双行，随后问语言）：

```
  ████╗     ██╗   ██╗   ██████╗     ████╗         ██████╗   ██╗   ██╗     ████╗     ██████╗     ██████╗
██╔═══██╗   ██║   ██║   ╚═██╔═╝   ██╔═══██╗     ██╔═════╝   ██║   ██║   ██╔═══██╗   ██╔═══██╗   ██╔═══██╗
██║   ██║   ██║   ██║     ██║     ██║   ██║     ██║         ██║   ██║   ██║   ██║   ██████╔═╝   ██║   ██║
████████║   ██║   ██║     ██║     ██║   ██║     ██║ ████╗   ██║   ██║   ████████║   ██╔═══██╗   ██║   ██║
██╔═══██║   ██║   ██║     ██║     ██║   ██║     ██║ ══██║   ██║   ██║   ██╔═══██║   ██║   ██║   ██║   ██║
██║   ██║   ██║   ██║     ██║     ██║   ██║     ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║
██║   ██║   ╚═████╔═╝     ██║     ╚═████╔═╝     ╚═████╔═╝   ╚═████╔═╝   ██║   ██║   ██║   ██║   ██████╔═╝
╚═╝   ╚═╝     ╚═══╝       ╚═╝       ╚═══╝         ╚═══╝       ╚═══╝     ╚═╝   ╚═╝   ╚═╝   ╚═╝   ╚═════╝
  auto-guard v0.3.0
  缓存式自动命令审查
  Cached Auto Command Review
  （适配 dsh / pi / zcode / claude / opencode / qoder）

请选择语言 / Select language:
  1. 中文 (Chinese)
  2. English
输入序号 / enter 1 or 2 [1]: ⏎

检测到以下宿主，选择要接入的（已检测到的默认勾选）：
  [x] 1. DeepSeek Harness （存在 ~/.dsh；找到可执行文件 dsh）
  [ ] 2. Pi Coding Agent （未检测到）
  [x] 3. ZCode （存在 ~/.zcode/cli/config.json；存在 ~/.zcode）
  [ ] 4. Claude Code （未检测到）
  [ ] 5. OpenCode （未检测到）
  [ ] 6. Qoder （未检测到）
回车确认默认勾选，或输入序号切换（如 1,3）：
⏎
[DeepSeek Harness] 将执行：
  · 运行 dsh plugin --profile web add link:C:\code\auto-guard\packages\host-dsh
[ZCode] 将执行：
  · 备份 ~/.zcode/cli/config.json → C:\Users\me\.zcode\cli\config.json.auto-guard.bak
  · 写入 ~/.zcode/cli/config.json
    + hooks.enabled = true
    + {"matcher":"^(Bash|Read|Write|Edit|ApplyPatch)$","hooks":[…]}
    + {"matcher":"^(startup|resume)$","hooks":[…]}
确认写入 DeepSeek Harness？(y/N)：y
确认写入 ZCode？(y/N)：y
[DeepSeek Harness] 完成
[ZCode] 完成

安装完成：
  · DeepSeek Harness（生效需新开会话）
  · ZCode（hooks 无热重载，必须新开 ZCode 会话）
验证：新开会话后运行 auto-guard guard status，或在宿主中执行一条命令观察审查提示
配置：各宿主独立 —— auto-guard set set-key --config-root ~/.<host>/auto-guard（也可 examine on 开审计）
卸载：auto-guard remove [--host dsh,pi,zcode,claude,opencode,qoder]
说明：守卫配置与数据在首次运行时播种到 ~/.<host>/auto-guard/，init 不创建这些文件
```

选 `2`（English）后流程完全一致，全部提示换成英文（例如 `Installation complete:`、`Write to ZCode? (y/N):`）。

**选一次，一直用**：交互提问的选择（以及 `--lang`）都会立即写入机器默认 `~/.auto-guard/config.json`（提问后马上落盘，不等安装结果）——之后再跑 `init` 读到机器默认就不再提问；`remove` 也不清除它，重装后语言偏好原样恢复。此后全产品（管理 CLI、引擎提示、宿主会话内的询问与拦截提示、LLM 裁决理由）都跟随这个设置；`[删除理由]` 是协议标记，永远保持中文。

头图说明：默认只在交互终端（stdout 为 TTY）显示，7 行实心块状大字（清晰字形）；立体钩边为 ANSI Shadow 同款双线字符（`══ ║ ╔ ╗ ╚ ╝`），由确定性规则从字形生成——右缘生竖线（起点 `╗`、止点 `╝`），下缘生横线（起头 `╚`、接笔画 `╔`），实心覆盖一切交叠，因此钩边永远贴合笔画、方向不会错乱；钩边与所在行渐变同色，颜色自上而下逐行渐变（亮青 → 蓝 → 紫，一行一色）；设了 `NO_COLOR` 时以无色版显示；管道 / CI 下完全不输出，保证结构化输出可解析——想在非交互环境看效果，加 `--banner` 强制显示。

### 2.2 `auto-guard init --host … --yes` — 非交互安装

CI / 脚本用，无 TTY 也可跑：

```bash
auto-guard init --host pi,zcode --yes
```

- `--host` 逗号分隔，可用值 `dsh` `pi` `zcode` `claude` `opencode` `qoder`；写了未知值会报错并列出可用值。
- `--yes` 跳过 diff 确认；**备份仍然强制执行**，不会被跳过。
- `--lang <zh|en>` 指定输出语言（也接受 `zh-CN` / `en-US` 这类区域写法），或设环境变量 `AUTO_GUARD_LANG`（POSIX：`export AUTO_GUARD_LANG=en`；PowerShell：`$env:AUTO_GUARD_LANG = "en"`）。非交互场景不提问：未指定时依次看环境变量、机器默认（`~/.auto-guard/config.json`），都没有则沿用中文，保证既有管道 / CI 输出不变。`--lang` 同时会更新机器默认。
- 指定的宿主必须被检测到，否则退出码 2 并提示先安装宿主（安装器**从不代装宿主**）。检测是启发式，确认无误要强制接入时，用交互模式手动勾选并确认路径。
- 典型输出：

```
[Pi Coding Agent] 将执行：
  · 备份 ~/.pi/agent/settings.json → …\settings.json.auto-guard.bak
  · 写入 ~/.pi/agent/settings.json
    + "…\packages\host-pi\src\index.ts"
[Pi Coding Agent] 完成
```

### 2.3 `auto-guard list` — 检测与接入状态

```bash
auto-guard list
```

```
[DeepSeek Harness]
  检测: 是（存在 ~/.dsh；找到可执行文件 dsh）
  接入: 已接入
  验证: auto-guard guard status
[Pi Coding Agent]
  检测: 否
  接入: 未接入
  下一步: 先安装 Pi Coding Agent，再运行 auto-guard init --host pi --yes
[ZCode]
  检测: 是（存在 ~/.zcode/cli/config.json）
  接入: 未接入
  下一步: auto-guard init --host zcode --yes
```

「未知（无法读取宿主配置）」= 目标配置文件存在但读不了（解析失败或查询命令失败），此时请手工检查后再操作。

### 2.4 `auto-guard remove` — 卸载

```bash
auto-guard remove                  # 卸全部
auto-guard remove --host zcode     # 只卸指定宿主
auto-guard remove --host pi --yes
```

- **有备份则还原**：`*.auto-guard.bak` 存在时逐字节还原原文件，备份随之删除（init 前是什么样，卸完就是什么样）。
- **无备份则结构化移除**：比如早期是手工接入的——只删 marker 匹配的 auto-guard 条目，你自己的配置一条不动。
- **dsh 走原生通道**：`dsh plugin --profile web remove auto-guard`；dsh CLI 不可用或未注册时报「未接入」，不算失败。
- **用户数据保留**：`~/.dsh、~/.pi、~/.zcode、~/.claude、~/.config/opencode、~/.qoder 下的 auto-guard/`（规则、缓存、审计库）原样保留；彻底清除请手动删除对应目录。

### 2.5 flags 一览

| flag | 适用命令 | 作用 |
|---|---|---|
| `--host <dsh,pi,zcode,claude,opencode,qoder>` | `init` `remove` | 指定宿主，逗号分隔；`remove` 省略时 = 全部 |
| `--yes` / `-y` | `init` `remove` | 跳过确认（init 的备份/校验不受影响） |
| `--lang <zh\|en>` | 全部安装器命令 | 输出语言；解析顺序 `--lang` → 环境变量 `AUTO_GUARD_LANG` → 交互 init 的双语提问 → 默认 `zh` |
| `--banner` | `init` | 强制显示头图（默认只在交互终端显示；管道、CI 下用它在任何环境预览） |
| `--home <path>` | 全部安装器命令 | 覆盖 HOME（多用户/测试场景） |
| `--config-root <path>` | 全部命令 | 管理命令用；**安装器接受但忽略**——配置根归守卫管，init 不创建、不修改 `~/.<host>/auto-guard/` |

**退出码**：`0` 成功；`2` 有宿主失败 / 未检测到宿主 / 未知 `--host` 值 / 非交互环境缺 flags。

### 2.6 各宿主写入内容对照

| | 检测特征 | 写入动作 | 生效条件 |
|---|---|---|---|
| **dsh** | `~/.dsh/` 存在 **且** `dsh` 在 PATH | `dsh plugin --profile web add link:<host-dsh 包路径>`（原生插件通道，web 为 dsh 默认 profile） | 新会话 |
| **pi** | `~/.pi/` 存在 **且** `pi` 在 PATH | `~/.pi/agent/settings.json` 的 `pi.extensions` 数组追加 host-pi 的 `src/index.ts`（jiti 直跑 TS，无需构建） | 新会话 |
| **zcode** | `~/.zcode/cli/config.json` 存在 | 该文件 `hooks.events.PreToolUse` / `hooks.events.SessionStart` 追加 `node <host-zcode>/dist/hook-cli.js` / `session-start.js`，并确保 `hooks.enabled: true`（配置文件 hooks 默认禁用；v0.3.0 误写在平铺 `hooks.PreToolUse` 等键下的条目会被 init/remove 自动清理——ZCode 对未知键会拒绝整个配置文件）（需先 `pnpm build` 产出 dist，缺了 init 会拒绝并提示） | 新会话；**hooks 无热重载，必须新开 ZCode 会话** |
| **claude** | `~/.claude/settings.json` 存在 | 该文件 `hooks.PreToolUse` / `hooks.SessionStart` 追加 `node <host-claude>/dist/hook-cli.js` / `session-start.js`（Claude Code 方言：`type: "command"` + 单字符串命令 + 秒级 `timeout`；matcher 含 NotebookEdit 覆盖 .ipynb 写路径） | 新会话；**hooks 无热重载，必须新开 Claude Code 会话** |
| **opencode** | `~/.config/opencode/opencode.json` 存在 | ① `plugin` 数组追加 `<host-opencode>/dist` 目录条目；② `permission` 对象的 `bash`/`edit`/`read` 三键首位插入 `"*": "ask"`（opencode 后匹配者优先，用户既有规则在前故优先；已有 `"*"` 则不动；该键是全局字符串动作时跳过不覆盖） | 新会话（插件随 opencode 启动加载） |
| **qoder** | `~/.qoder/settings.json` 存在 | 该文件 `hooks.PreToolUse` / `hooks.SessionStart` 追加 `node <host-qoder>/dist/hook-cli.js` / `session-start.js`（Claude Code 同构方言：`type: "command"` + 秒级 `timeout`；matcher 覆盖 Qoder 双命名工具集与 `apply_patch` 别名；只支持国际版 IDE，CN 版与 CLI 入口不适配） | 新会话；**hooks 无热重载，必须新开 Qoder 会话** |

检测按「与」语义：标志文件单独命中即可，否则需要目录 + 可执行同时命中——只装了同名可执行文件不算，避免写进不存在的宿主。

#### claude 宿主专属警示

**cc-switch / clawd 等切换器会整体覆写 `~/.claude/settings.json`，把 hooks 一并抹掉**（本机曾有三份清理备份为证）。症状：守卫突然全静默（任何命令都不弹确认）。自检与恢复：

```bash
node <host-claude>/dist/cli.js guard ping     # hook 是否活着（用 claude 配置根）
auto-guard list                                # claude 行显示「未接入」= hooks 已丢
auto-guard init --host claude --yes            # 重新写入即恢复
```

#### opencode 宿主专属说明

- **启动器修复**：npm 安装 opencode-ai 时若 postinstall 未执行，`opencode --version` 会报 "postinstall script was not run"。一行修复：`node <npm 全局目录>/node_modules/opencode-ai/postinstall.mjs`。检测以文件证据为主，启动器损坏不影响安装器。
- **ask 体验**：守卫 ask 落 opencode 原生 TUI 三态——**一次 / 本会话总是 / 拒绝**。选「本会话总是」后，同模式调用经宿主放行、**不再进守卫**（ADR-0015 接受的宿主委托语义）；用户既有 permission allow 规则放行的调用同样不进守卫。
- **remove 保留项**：`auto-guard remove` 只撤 `plugin` 数组条目；permission 里插入的 `"*": "ask"` **保留**（无法区分归属）。彻底清理请手工删除各工具对象首位的该键。

#### qoder 宿主专属说明

- **只支持国际版 Qoder IDE**：用户级配置为 `~/.qoder/settings.json`。CN 版（`~/.qoder-cn/`，灵码系）与 Qoder CLI 入口不适配、不验证。
- **共享配置的副作用**：Qoder 的 hooks 配置在 IDE / CLI 入口间共享，CLI 若支持同名事件也会执行本守卫——接受的副作用，不另做适配。
- **工具覆盖面**：matcher 覆盖 Qoder 的双命名工具集（`Bash|Read|Write|Edit` 短名与 `run_in_terminal|read_file|create_file|search_replace` 长名）与 `apply_patch` 别名；Qoder 特有的 `delete_file` 工具合成为单文件 bash `rm "<路径>"` 守卫，与真实 bash `rm` 同流。
- **无热重载**：装完或改完 hooks 都必须新开 Qoder 会话；守卫失效时先确认 `~/.qoder/settings.json` 的 `hooks.PreToolUse` 还在，再重跑 `auto-guard init --host qoder --yes`。

### 2.7 安全保证

- **绝不触碰 profile 之外的文件**；每次写入前 diff 可见、确认后执行（`--yes` 也保留备份）。
- **幂等**：重复 init 自动跳过已接入条目，已有备份永不被二次覆盖——连跑多次结果一致。
- **可完全卸载**：`remove` 还原或结构化移除，数据根保留。
- **中断安全**：多宿主逐个处理，任一步失败立即停在该宿主并报出失败步骤（backup / write / verify / run-command），其余宿主不受影响，最后汇总哪些没完成（退出码 2）。

---

## 3. 管理命令

### 3.0 命令行配置的是哪个宿主？

管理命令作用在某个宿主的**配置根**上。**每个宿主的配置完全独立**——API Key、审计库、学习规则、规则文件都互不共享，给哪个宿主做配置，就把命令指到哪个宿主的根：

| 宿主 | 配置根 |
|---|---|
| DeepSeek Harness | `~/.dsh/auto-guard` |
| Pi Coding Agent | `~/.pi/auto-guard` |
| ZCode | `~/.zcode/auto-guard` |
| Claude Code | `~/.claude/auto-guard` |
| OpenCode | `~/.config/opencode/auto-guard` |
| Qoder（国际版） | `~/.qoder/auto-guard` |

根的解析顺序（全部管理命令通用）：

```
--config-root <path>  →  环境变量 AUTO_GUARD_CONFIG_ROOT  →  自动探测（~/.zcode → ~/.claude → ~/.config/opencode → ~/.pi → ~/.dsh，取第一个存在的）
```

三个都失败时报错并要求显式指定。退出码：`0` 成功、`2` 拒绝/失败、`1` 用法错误。

**装了多个宿主时，自动探测永远只命中一个**（zcode 优先），此时给其它宿主做配置必须显式指定根：

```bash
# 方式一：单条命令临时指定（推荐，路径换成目标宿主即可）
auto-guard set set-key  --config-root ~/.pi/auto-guard          # 给 Pi 配 Key
auto-guard examine on   --config-root ~/.dsh/auto-guard         # 给 dsh 开审计
auto-guard set set-api model deepseek-chat --config-root ~/.pi/auto-guard

# 方式二：整个会话固定一个宿主，之后的命令都不用再带 --config-root
export AUTO_GUARD_CONFIG_ROOT=~/.pi/auto-guard        # PowerShell：$env:AUTO_GUARD_CONFIG_ROOT = "$HOME\.pi\auto-guard"
auto-guard set set-key
auto-guard examine on
```

`--config-root` 写在命令任意位置都可以（`auto-guard set set-key --config-root …` 与 `auto-guard --config-root … set set-key` 等价）。安装器命令（`init`/`list`/`remove`）接受但忽略该 flag——配置根归守卫管，init 不创建、不修改 `~/.<host>/auto-guard/`。

### 3.1 `guard` — 启停与状态

```bash
auto-guard guard on              # 开启守卫（作用于解析出的那个宿主根）
auto-guard guard off             # 关闭（dsh 宿主例外：唯一开关是权限预设 auto-guard）
auto-guard guard status          # 多宿主状态总览（见下）
auto-guard guard status --config-root ~/.zcode/auto-guard   # 只看一个宿主
auto-guard guard recent 20       # 最近 20 条裁决历史（默认 10；zcode 宿主的拉取式通知源）
auto-guard guard stats           # 审计库记录总数
auto-guard guard report          # 近 7 天审查统计：按裁决种类与决策来源（LLM / 各规则层 / 各缓存层）
auto-guard guard report 30       # 自定义窗口：近 30 天
auto-guard guard ping            # DeepSeek API 连通性测试
```

`guard report` 输出示例（需 `examine on`；审计库只存 shell 命令裁决，报告即全部裁决的构成）：

```
🛡️ 近 7 天命令审查报告（审计库共 561 条）
共 87 条裁决：allow 70 · deny 9 · ask 8
LLM 审查 12 次 · fail-closed 兜底 1 次
按来源：
  LLM      12
  白名单    45
  会话缓存   18
  持久缓存   7
  ...
```

`report` 的数字直接来自审计库 GROUP BY（`decision_kind` / `decision_source` / `reviewer_failed`），来源显示名与通知里的标签一致（`[LLM]`、`[白名单]`、`[会话缓存]`…）。

`guard status` 的两种视图：

- **自动探测根时 → 多宿主总览**：已播种的宿主显示完整状态；宿主已安装但还没跑过守卫会话的显示「尚未播种」；本机没有的宿主不显示。该视图是只读的，不会替你创建任何配置。
- **显式 `--config-root` / `AUTO_GUARD_CONFIG_ROOT` 时 → 单宿主视图**：只渲染指定根。

自动探测根时的典型输出：

```
🛡️ auto-guard 多宿主状态

🛡️ Pi Coding Agent — ~/.pi/auto-guard
  enabled : true
  lang    : zh
  config  : C:\Users\me\.pi\auto-guard\config.json
  review  : https://api.deepseek.com · deepseek-v4-flash
  examine : on · history: off
  审计库记录总数：561

🛡️ ZCode — ~/.zcode/auto-guard
  enabled : true
  lang    : en
  config  : C:\Users\me\.zcode\auto-guard\config.json
  review  : https://api.deepseek.com · deepseek-v4-flash
  examine : on · history: on
  审计库记录总数：759
  last    : Write → allow [passthrough] @ 08-28 17:24:33 · D:\proj\README.md

◇ DeepSeek Harness — ~/.dsh/auto-guard：尚未播种（新开一次 DeepSeek Harness 会话后自动创建）

（管理命令作用于单个宿主：加 --config-root ~/.<host>/auto-guard，或设 AUTO_GUARD_CONFIG_ROOT）
```

每个宿主显示一行 `lang`：该根的**生效语言**（四层解析后的结果，见 3.2；各根可以不同——上图 Pi 跟随中文兜底，ZCode 被单独设成了英文）。

注意：聚合的只有 `status` 这一个只读视图；`guard on/off`、`set`、`examine`、`optimize` 始终作用于解析出的**单个**配置根（见 3.0）。

### 3.2 `set` — Key、API 与语言配置

API Key 解析优先级：**环境变量 → 加密存储（`api-key.json`，AES-256-GCM 机器绑定）→ 遗留明文字段（只读）**。

```bash
auto-guard set set-key           # 三步 TTY 向导，回显关闭；Key 不进 shell 历史
auto-guard set show-key          # env / 加密存储 / 遗留明文三层状态（脱敏显示）
auto-guard set clear-key         # 删除加密存储（环境变量不受影响）
auto-guard set set-api base https://api.deepseek.com   # 改审查端点
auto-guard set set-api model deepseek-v4-flash         # 改审查模型
auto-guard set set-api reset                           # 恢复默认
auto-guard set lang en           # 本宿主输出语言切换为英文（回执也用新语言）
auto-guard set lang zh           # 切回中文
auto-guard set history on        # 开运行时历史层（配合 guard recent）
auto-guard set reload            # 提示：配置与规则每次 hook 进程启动时自动重读
```

安全约定：Key 永远不接受命令行参数（shell 历史会留存），只走 TTY 向导或环境变量 `DEEPSEEK_API_KEY`（可用 `apiKeyEnv` 改名）。

**语言设置（四层解析）**。`set lang` 写入当前配置根的 `lang` 字段，只影响这一个宿主；全产品生效语言按以下顺序解析（第一层命中即止）：

```
环境变量 AUTO_GUARD_LANG   →   各宿主 config.json 的 lang（set lang 写入）   →   机器默认 ~/.auto-guard/config.json（安装器写入）   →   中文兜底
```

- 环境变量是单次调用覆盖，适合 CI / 脚本固定输出语言，不落盘。
- 机器默认由安装器在语言提问或 `--lang` 后立即写入；未单独设置过的宿主都跟随它。
- 中文兜底保证存量用户与既有测试零变化；`set lang` 后回执立即用新语言输出，作为生效证明。
- LLM 裁决理由语言跟随该设置落库；`[删除理由]` 协议标记与其解析不受影响，历史记录不翻译。
- 改语言在下次进程启动生效即可（hook 本就每次启动重读配置）；ZCode 宿主自带管理 CLI（`node dist/cli.js`）与管理 CLI 行为一致，也有 `set lang`。

### 3.3 `examine` — 审计日志（本地 SQLite，默认关）

```bash
auto-guard examine on            # 开启：裁决入库，字段级加密，数据不出本机
auto-guard examine status
auto-guard examine clear-old     # 删 30 天前记录
auto-guard examine clear-all
```

`examine on` 是 `optimize analyze`（学习规则）与 `guard stats` 的数据源。

### 3.4 `optimize` — 学习规则

```bash
auto-guard optimize status       # 学习层状态、上次分析时间
auto-guard optimize analyze      # 从审计历史生成可缓存规则（需 examine on；保守阈值）
auto-guard optimize list         # 看已生成的学习规则
auto-guard optimize rollback     # 回滚到备份
```

---

## 4. 首次使用完整流程

```bash
# 1. 装守卫（以 zcode 为例）
auto-guard init                  # 或 auto-guard init --host zcode --yes

# 2. 新开宿主会话（zcode hooks 无热重载，必须新开）

# 3. 验证
auto-guard list                  # 接入的宿主应显示「已接入」
auto-guard guard status          # 多宿主总览；只看 zcode：加 --config-root ~/.zcode/auto-guard

# 4.（可选）配 Key、开审计 —— 每个宿主的配置独立，各配一次
auto-guard set set-key                                   # 自动探测命中的宿主（zcode 优先）
auto-guard set set-key --config-root ~/.pi/auto-guard    # 其它宿主须显式指定
auto-guard examine on

# 5. 不想要了
auto-guard remove --host zcode
```

---

## 5. 相关文档

- [故障排查](troubleshooting.md)：检测不到宿主 / hooks 未生效 / 权限被宿主默认禁用 / claude hooks 被切换器抹掉 / opencode 启动器修复
- [新宿主接入指南](new-host.md)：一条 profile + 一个适配层包（ADR-0008）
- [CLI 指南](cli.md)：管理命令速查表（英文）
- [ADR-0008](adr/0008-installer-profiles-explicit-and-reversible.md)：安装器设计决策
- [ADR-0015](adr/0015-opencode-permission-ask-delegation.md)：opencode 权限系统委托（含 1.18.x 事件通道实现期修订）
- [ADR-0017](adr/0017-platform-support-windows-macos.md)：平台支持（Windows + macOS；跨平台代码纪律）

---

## 6. TUI 控制台（auto-guard-tui）

> SPEC 0009 / ADR-0014。参考 ccstatusline 的体验标准（全屏、powerline 头、实时预览、危险操作守卫式确认），但零依赖手写 ANSI 渲染，不引入 Ink/React。

如果你的宿主没有 DSH 那样的设置页（zcode / claude / opencode / qoder / pi），这是你的图形化管理台；DSH 用户想用同样可以。

```bash
# 本仓库开发树
node packages/tui/dist/tui.js        # 先 pnpm build
node packages/tui/src/tui.ts         # Node 22.18+ 免构建直跑

# 安装为 bin 后
auto-guard-tui
```

**八屏布局**：总览（每宿主状态卡 + 选根 + ping + 界面语言切换行）→ 守卫（开关/status/recent/stats/report/ping）→ 审计（开关/清理）→ 优化（analyze/list/rollback）→ 密钥（按 密钥管理 / API 端点 / 偏好 / 维护 分组：show-key、三步 set-key 向导掩码输入、clear-key、set-api、历史层、reload）→ 安装（检测多选 → 规则更新选择 → 预览 → 确认安装 / list / remove）→ 日志（全部回执流水）→ 帮助（键位 + 命令对照表）。

**关键约定**：

- 所有动作经 `runCli` / `runInstallerCommand` 执行——回执与命令行逐字一致（单一语义来源）；回执行只显示你输入的命令，TUI 内部注入的 `--config-root` 不出现在任何显示通道；
- 首次进入守卫 / 审计 / 优化 / 密钥屏自动加载对应只读命令填充输出面板（不进日志屏）；总览屏 ≥110×20 显示 AUTO GUARD 渐变字标；
- 输出面板只折行、不静默截断（SPEC 0011）：超宽行折到面板宽度续行显示，`PgUp/PgDn` 翻页、`g/G` 滚动首尾（帮助页同款），新回执自动贴底；`←→/hl` 切屏、`↑↓/jk` 移动动作光标互不冲突；
- `:` 进入命令模式：任意 CLI argv 直通执行（如 `: guard report 30`、`: init list`），这是全命令面的保底通道；
- 危险操作（clear-all / clear-key / rollback / remove / 安装 apply）必须过确认框，Esc 取消；
- set-key 三步向导：base → model → key（掩码），Enter 保留现值；key 永不落 argv、不进日志；
- 双语界面，语言跟随四层解析（`AUTO_GUARD_LANG` > 当前根 `config.lang` > 机器默认 > zh）；`set lang` 即切即生效；
- 键位（SPEC 0011）：`←→/hl` 切屏 · `↑↓/jk` 移动 · `Enter` 执行 · `Space` 勾选 · `PgUp/PgDn` 翻页（输出面板/帮助） · `Tab/Shift+Tab` 安装子页 · `1-8` 跳转 · `:` 命令 · `r` 刷新（重跑当前屏自动加载） · `g/G` 滚首/尾 · `q`/`Ctrl+C` 退出（自动恢复终端）。

**限制**：需要真 TTY 与 VT 转义（macOS Terminal / iTerm2、Windows Terminal / Git Bash / ConEmu / mintty / 常见 SSH 都满足）；非 TTY 或 `TERM=dumb` 启动即拒绝（exit 2，提示改用 CLI）；未检测到的宿主不能在 TUI 里强装（CLI 的 `--host` 路径本身拒绝未检测宿主，fail-closed）。
