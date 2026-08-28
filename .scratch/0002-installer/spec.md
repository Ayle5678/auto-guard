# SPEC 0002 — installer：`auto-guard init`，安装时选择适配宿主

> Effort: 0002-installer
Status: done
> 前置: SPEC 0001（依赖 core 操作层与三适配层包）
> 参考: headroom 的 `wrap <agent>` 安装选择体验 · caveman 的 agents/profiles 数据驱动多工具分发

## Problem Statement

统一包有三个宿主，用户不应手工读三份安装文档。目标是一个安装软件：运行 `auto-guard init`，检测本机已有的编码 agent 宿主，让用户勾选适配哪些，然后写入各自的集成；配套完整卸载。

## Solution

`packages/cli` 里的安装器命令（Node ≥ 20、零外部依赖、TTY 交互 + 非交互 flags）：

```
auto-guard init                # 检测 + 交互多选 + 写入
auto-guard init --host pi,zcode --yes
auto-guard remove [--host ...] # 卸载，还原备份
auto-guard list                # 列出检测到的宿主与当前接入状态
```

### 宿主 profile（数据，不是代码）

每个宿主一条 profile，描述：检测特征、写入位置、写入内容模板、卸载方式。新增宿主优先加 profile（ADR-0008）。

| 字段 | host-dsh | host-pi | host-zcode |
|---|---|---|---|
| 检测特征 | `~/.dsh/` 存在 + `dsh` 可执行 | `~/.pi/` 存在 + `pi` 可执行 | `~/.zcode/cli/config.json` 存在 |
| 写入动作 | dsh 插件注册（plugin add 或 profile web 配置） | `~/.pi/agent/settings.json` 或项目 `.pi/settings.json` 的 `pi.extensions` 追加路径 | `~/.zcode/cli/config.json` hooks 追加 PreToolUse/SessionStart；或插件目录复制 |
| 写入内容 | host-dsh 包路径 | host-pi 包 src/index.ts 路径 | host-zcode dist 路径 + commands 拷贝 |
| 生效条件 | 新会话 | 新会话 | 新会话（hooks 无热重载，须提示） |

### 交互流（headroom 式选择）

1. 扫描 → 列出检测到的宿主（复选框，已检测到的默认勾选；未检测到的可手动勾选并要求确认路径）。
2. 每宿主写入前：显示将改动的文件与 diff 摘要 → 备份原文件（`*.auto-guard.bak`）→ 写入 → 校验。
3. 汇总：装了什么、怎么验证（`guard status` / 新开会话）、怎么卸载。

## User Stories

1. 作为新用户，我运行一条命令、勾选两个宿主，守卫即同时接入 dsh 与 zcode。
2. 作为谨慎的用户，安装器先给我看要改哪个文件、改成什么样，并且我能一键还原。
3. 作为 CI/脚本用户，我用 `--host pi --yes` 非交互安装。
4. 作为多宿主作者，我新增第四个宿主时只写一条 profile + 一个适配层包，不改安装器逻辑。

## Implementation Decisions

- 备份、幂等（重复 init 结果一致）、`remove` 还原是硬约束（ADR-0008）。
- 安装器**不安装宿主本身**：只检测。目标宿主未安装时提示先装宿主。
- 各宿主**原生渠道不废弃**：dsh plugin add / pi install / zcode 插件管理与安装器并存，profile 的写入动作就是复用各渠道的等效配置。
- 配置根不归安装器管：init 不创建/修改 `~/.<host>/auto-guard/`，首次运行播种交给守卫自身。
- 检测纯启发式（目录 + 可执行文件探测），交互中可否决误检。

## Testing Decisions

- profile 解析与写入计划生成：纯函数单测（给定文件系统快照 → 断言写入计划）。
- 临时目录集成测试：fake HOME 下 init → 断言文件内容与备份 → remove → 断言还原。
- 幂等测试：连续两次 init 结果一致、备份不被二次覆盖。

## Out of Scope

- npm 发布渠道本身（发什么包、版本号策略归 SPEC 0001 issue 12）。
- 宿主自身的安装引导。
- GUI 安装器。

## Further Notes

- Blocked tickets 见本目录 issues/。实施依赖 SPEC 0001 的 issue 01/07/08/09（需要可安装的包产物）。
- 相关 ADR：0008（安装器）。
