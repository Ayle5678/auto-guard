# auto-guard 使用手册

auto-guard 是多宿主命令审查守卫：在你的 AI 编码 agent 执行命令或读写文件**之前**，按静态规则、缓存、学习规则、审计历史和可选 LLM 审查给出 **allow / deny / ask** 裁决。本手册覆盖全部命令行用法；概念与架构见 [README](../README.zh-CN.md)，装不上/不生效见[故障排查](troubleshooting.md)。

---

## 1. 运行方式

三种等价入口（Node ≥ 20，零外部依赖）：

```bash
# 1) npx（发布后）
npx @auto-guard/cli <命令>

# 2) 本仓库开发树（Node 23+ 可直跑 TS）
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

0. **头图**：交互终端下先打印青蓝紫渐变块状大字；此刻语言未定，tagline 为双语（`多宿主命令审查守卫 / Multi-host command review guard`）。
1. **选语言**：双语提问「请选择语言 / Select language」，输入 `1` 中文（默认，回车即选）、`2` English；之后的所有提示跟随所选语言。脚本 / CI 可用 `--lang` 或环境变量 `AUTO_GUARD_LANG` 跳过提问（见 2.2 / 2.5）。
2. **扫描**：按各宿主特征（目录 / 标志文件 / PATH 上的可执行文件）检测本机已装的宿主。
3. **勾选**：复选框列表，已检测到的默认勾选；输入序号可切换，回车确认。手动勾选未检测到的宿主时会显示写入目标并要求二次确认（防误装）。
4. **预览 + 写入**：每宿主展示将执行的步骤和 diff 摘要 → 确认 → 备份原文件为 `*.auto-guard.bak` → 写入 → 读回校验。
5. **汇总**：装了什么、如何验证、如何卸载。

交互示例（dsh 与 zcode 已装、pi 未装；TTY 下先进头图，tagline 双语，随后问语言）：

```
  ████╗     ██╗   ██╗   ██████╗     ████╗         ██████╗   ██╗   ██╗     ████╗     ██████╗     ██████╗
██╔═══██╗   ██║   ██║   ╚═██╔═╝   ██╔═══██╗     ██╔═════╝   ██║   ██║   ██╔═══██╗   ██╔═══██╗   ██╔═══██╗
██║   ██║   ██║   ██║     ██║     ██║   ██║     ██║         ██║   ██║   ██║   ██║   ██████╔═╝   ██║   ██║
████████║   ██║   ██║     ██║     ██║   ██║     ██║ ████╗   ██║   ██║   ████████║   ██╔═══██╗   ██║   ██║
██╔═══██║   ██║   ██║     ██║     ██║   ██║     ██║ ══██║   ██║   ██║   ██╔═══██║   ██║   ██║   ██║   ██║
██║   ██║   ██║   ██║     ██║     ██║   ██║     ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║   ██║
██║   ██║   ╚═████╔═╝     ██║     ╚═████╔═╝     ╚═████╔═╝   ╚═████╔═╝   ██║   ██║   ██║   ██║   ██████╔═╝
╚═╝   ╚═╝     ╚═══╝       ╚═╝       ╚═══╝         ╚═══╝       ╚═══╝     ╚═╝   ╚═╝   ╚═╝   ╚═╝   ╚═════╝
  auto-guard v0.3.0 — 多宿主命令审查守卫 / Multi-host command review guard（dsh / pi / zcode）

请选择语言 / Select language:
  1. 中文 (Chinese)
  2. English
输入序号 / enter 1 or 2 [1]: ⏎

检测到以下宿主，选择要接入的（已检测到的默认勾选）：
  [x] 1. DeepSeek Harness （存在 ~/.dsh；找到可执行文件 dsh）
  [ ] 2. Pi Coding Agent （未检测到）
  [x] 3. ZCode （存在 ~/.zcode/cli/config.json）
回车确认默认勾选，或输入序号切换（如 1,3）：
⏎
[DeepSeek Harness] 将执行：
  · 运行 dsh plugin add C:\code\auto-guard\packages\host-dsh
[ZCode] 将执行：
  · 备份 ~/.zcode/cli/config.json → C:\Users\me\.zcode\cli\config.json.auto-guard.bak
  · 写入 ~/.zcode/cli/config.json
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
卸载：auto-guard remove [--host dsh,pi,zcode]
说明：守卫配置与数据在首次运行时播种到 ~/.<host>/auto-guard/，init 不创建这些文件
```

选 `2`（English）后流程完全一致，全部提示换成英文（例如 `Installation complete:`、`Write to ZCode? (y/N):`）。

头图说明：默认只在交互终端（stdout 为 TTY）显示，7 行实心块状大字（清晰字形）；立体钩边为 ANSI Shadow 同款双线字符（`══ ║ ╔ ╗ ╚ ╝`），由确定性规则从字形生成——右缘生竖线（起点 `╗`、止点 `╝`），下缘生横线（起头 `╚`、接笔画 `╔`），实心覆盖一切交叠，因此钩边永远贴合笔画、方向不会错乱；钩边与所在行渐变同色，颜色自上而下逐行渐变（亮青 → 蓝 → 紫，一行一色）；设了 `NO_COLOR` 时以无色版显示；管道 / CI 下完全不输出，保证结构化输出可解析——想在非交互环境看效果，加 `--banner` 强制显示。

### 2.2 `auto-guard init --host … --yes` — 非交互安装

CI / 脚本用，无 TTY 也可跑：

```bash
auto-guard init --host pi,zcode --yes
```

- `--host` 逗号分隔，可用值 `dsh` `pi` `zcode`；写了未知值会报错并列出可用值。
- `--yes` 跳过 diff 确认；**备份仍然强制执行**，不会被跳过。
- `--lang <zh|en>` 指定输出语言（也接受 `zh-CN` / `en-US` 这类区域写法），或设环境变量 `AUTO_GUARD_LANG=en`。非交互场景不提问：未指定时沿用中文，保证既有管道 / CI 输出不变。
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
- **dsh 走原生通道**：`dsh plugin remove dsh-auto-guard`；dsh CLI 不可用或未注册时报「未接入」，不算失败。
- **用户数据保留**：`~/.dsh|~/.pi|~/.zcode/auto-guard/`（规则、缓存、审计库）原样保留；彻底清除请手动删除对应目录。

### 2.5 flags 一览

| flag | 适用命令 | 作用 |
|---|---|---|
| `--host <dsh,pi,zcode>` | `init` `remove` | 指定宿主，逗号分隔；`remove` 省略时 = 全部 |
| `--yes` / `-y` | `init` `remove` | 跳过确认（init 的备份/校验不受影响） |
| `--lang <zh\|en>` | 全部安装器命令 | 输出语言；解析顺序 `--lang` → 环境变量 `AUTO_GUARD_LANG` → 交互 init 的双语提问 → 默认 `zh` |
| `--banner` | `init` | 强制显示头图（默认只在交互终端显示；管道、CI 下用它在任何环境预览） |
| `--home <path>` | 全部安装器命令 | 覆盖 HOME（多用户/测试场景） |
| `--config-root <path>` | 全部命令 | 管理命令用；**安装器接受但忽略**——配置根归守卫管，init 不创建、不修改 `~/.<host>/auto-guard/` |

**退出码**：`0` 成功；`2` 有宿主失败 / 未检测到宿主 / 未知 `--host` 值 / 非交互环境缺 flags。

### 2.6 各宿主写入内容对照

| | 检测特征 | 写入动作 | 生效条件 |
|---|---|---|---|
| **dsh** | `~/.dsh/` 存在 **且** `dsh` 在 PATH | `dsh plugin add <host-dsh 包路径>`（原生插件通道） | 新会话 |
| **pi** | `~/.pi/` 存在 **且** `pi` 在 PATH | `~/.pi/agent/settings.json` 的 `pi.extensions` 数组追加 host-pi 的 `src/index.ts`（jiti 直跑 TS，无需构建） | 新会话 |
| **zcode** | `~/.zcode/cli/config.json` 存在 | 该文件 `hooks.PreToolUse` / `hooks.SessionStart` 追加 `node <host-zcode>/dist/hook-cli.js` / `session-start.js`（需先 `pnpm build` 产出 dist，缺了 init 会拒绝并提示） | 新会话；**hooks 无热重载，必须新开 ZCode 会话** |

检测按「与」语义：标志文件单独命中即可，否则需要目录 + 可执行同时命中——只装了同名可执行文件不算，避免写进不存在的宿主。

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

根的解析顺序（全部管理命令通用）：

```
--config-root <path>  →  环境变量 AUTO_GUARD_CONFIG_ROOT  →  自动探测（~/.zcode → ~/.pi → ~/.dsh，取第一个存在的）
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
auto-guard guard ping            # DeepSeek API 连通性测试
```

`guard status` 的两种视图：

- **自动探测根时 → 多宿主总览**：已播种的宿主显示完整状态；宿主已安装但还没跑过守卫会话的显示「尚未播种」；本机没有的宿主不显示。该视图是只读的，不会替你创建任何配置。
- **显式 `--config-root` / `AUTO_GUARD_CONFIG_ROOT` 时 → 单宿主视图**：只渲染指定根。

自动探测根时的典型输出：

```
🛡️ auto-guard 多宿主状态

🛡️ Pi Coding Agent — ~/.pi/auto-guard
  enabled : true
  config  : C:\Users\me\.pi\auto-guard\config.json
  review  : https://api.deepseek.com · deepseek-v4-flash
  examine : on · history: off
  审计库记录总数：561

🛡️ ZCode — ~/.zcode/auto-guard
  enabled : true
  config  : C:\Users\me\.zcode\auto-guard\config.json
  review  : https://api.deepseek.com · deepseek-v4-flash
  examine : on · history: on
  审计库记录总数：759
  last    : Write → allow [passthrough] @ 08-28 17:24:33 · D:\proj\README.md

◇ DeepSeek Harness — ~/.dsh/auto-guard：尚未播种（新开一次 DeepSeek Harness 会话后自动创建）

（管理命令作用于单个宿主：加 --config-root ~/.<host>/auto-guard，或设 AUTO_GUARD_CONFIG_ROOT）
```

注意：聚合的只有 `status` 这一个只读视图；`guard on/off`、`set`、`examine`、`optimize` 始终作用于解析出的**单个**配置根（见 3.0）。

### 3.2 `set` — Key 与 API 配置

API Key 解析优先级：**环境变量 → 加密存储（`api-key.json`，AES-256-GCM 机器绑定）→ 遗留明文字段（只读）**。

```bash
auto-guard set set-key           # 三步 TTY 向导，回显关闭；Key 不进 shell 历史
auto-guard set show-key          # env / 加密存储 / 遗留明文三层状态（脱敏显示）
auto-guard set clear-key         # 删除加密存储（环境变量不受影响）
auto-guard set set-api base https://api.deepseek.com   # 改审查端点
auto-guard set set-api model deepseek-v4-flash         # 改审查模型
auto-guard set set-api reset                           # 恢复默认
auto-guard set history on        # 开运行时历史层（配合 guard recent）
auto-guard set reload            # 提示：配置与规则每次 hook 进程启动时自动重读
```

安全约定：Key 永远不接受命令行参数（shell 历史会留存），只走 TTY 向导或环境变量 `DEEPSEEK_API_KEY`（可用 `apiKeyEnv` 改名）。

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

- [故障排查](troubleshooting.md)：检测不到宿主 / hooks 未生效 / 权限被宿主默认禁用
- [新宿主接入指南](new-host.md)：一条 profile + 一个适配层包（ADR-0008）
- [CLI 指南](cli.md)：管理命令速查表（英文）
- [ADR-0008](adr/0008-installer-profiles-explicit-and-reversible.md)：安装器设计决策
