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

流程四步：

1. **扫描**：按各宿主特征（目录 / 标志文件 / PATH 上的可执行文件）检测本机已装的宿主。
2. **勾选**：复选框列表，已检测到的默认勾选；输入序号可切换，回车确认。手动勾选未检测到的宿主时会显示写入目标并要求二次确认（防误装）。
3. **预览 + 写入**：每宿主展示将执行的步骤和 diff 摘要 → 确认 → 备份原文件为 `*.auto-guard.bak` → 写入 → 读回校验。
4. **汇总**：装了什么、如何验证、如何卸载。

交互示例（dsh 与 zcode 已装、pi 未装）：

```
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
卸载：auto-guard remove [--host dsh,pi,zcode]
说明：守卫配置与数据在首次运行时播种到 ~/.<host>/auto-guard/，init 不创建这些文件
```

### 2.2 `auto-guard init --host … --yes` — 非交互安装

CI / 脚本用，无 TTY 也可跑：

```bash
auto-guard init --host pi,zcode --yes
```

- `--host` 逗号分隔，可用值 `dsh` `pi` `zcode`；写了未知值会报错并列出可用值。
- `--yes` 跳过 diff 确认；**备份仍然强制执行**，不会被跳过。
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

管理命令作用在某个宿主的**配置根**（`~/.dsh|~/.pi|~/.zcode/auto-guard/`）。解析顺序：

```
--config-root <path>  →  环境变量 AUTO_GUARD_CONFIG_ROOT  →  自动探测（~/.zcode → ~/.pi → ~/.dsh，取第一个存在的）
```

三个都失败时报错并要求显式指定。退出码：`0` 成功、`2` 拒绝/失败、`1` 用法错误。

### 3.1 `guard` — 启停与状态

```bash
auto-guard guard on              # 开启守卫
auto-guard guard off             # 关闭（dsh 宿主例外：唯一开关是权限预设 auto-guard）
auto-guard guard status          # 版本、开关、模型、缓存路径、接入状态
auto-guard guard recent 20       # 最近 20 条裁决历史（默认 10；zcode 宿主的拉取式通知源）
auto-guard guard stats           # 审计库记录总数
auto-guard guard ping            # DeepSeek API 连通性测试
```

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
auto-guard list                  # ZCode 应显示「已接入」
auto-guard guard status          # 需要时 --config-root ~/.zcode/auto-guard

# 4.（可选）配 Key、开审计
auto-guard set set-key
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
