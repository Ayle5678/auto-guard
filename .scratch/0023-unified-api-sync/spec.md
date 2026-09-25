# 0023 — 统一 API 同步：一条命令为所有本地宿主设置评审端点

> Status: resolved
> 决策依据：ADR-0022（能力声明模型的多根命令组应用）；不设新 ADR。

## Problem Statement

一台机器装多个宿主（zcode/claude/qoder/opencode/codex/pi/dsh）时，切换评审 API（端点 + 模型）要在每个宿主根各跑一次 `set set-api`；换 Key 还要逐根 `set set-key`。付税的是多宿主用户；聚合状态已经证明统一 CLI 天然持有「所有宿主根」的视角，但写面还没有对应物。

## Solution

统一 CLI 新增 `sync-api` 命令组（引擎能力门控，仅统一入口声明）：`auto-guard sync-api <base> <model> [--fallback <model>] [--propagate-key]`。目标 = hostRoots 里宿主已装且 auto-guard 已播种（config.json 存在）的根；对每个根做**定向 JSON 补丁**（只改 apiBase/model/fallbackModel 三键，其余字段与键序原样保留——dsh 的 provider 族字段不受影响）；`--fallback` 缺省回落 model（与 pi 的 set-api 行为一致）。`--propagate-key` 把当前根（探测或 --config-root 指定）已存的加密 Key 复制到其余同步根（loadApiKey → saveApiKey，不经过命令行、不回显）。

## User Stories

1. 作为多宿主用户，我跑一条命令就把所有已装宿主的评审端点/模型切到同一 API，所以不用逐根设置。
2. 作为多宿主用户，我加一个 flag 就把已有加密 Key 铺到所有根，所以新根不用再进向导。
3. 作为某宿主的用户，我根上的其他配置（TTL、通知、dsh 的 provider 字段）不被触碰，所以同步对我无副作用。
4. 作为贡献者，sync-api 是引擎能力门控的命令组，所以运行时入口的命令面不扩大（usage 不出现、分发回落 usage 退出 1）。

## Implementation Decisions

- **归属**：命令组落 createCliMain 引擎（dispatch/usage/退出码单源），`CliCapabilities.apiSync` 门控；仅 packages/cli 驱动声明。hostRoots 复用 aggregate 的驱动缝。
- **写入方式**：定向 JSON 补丁（读 config.json → 改三键 → 2 空格缩进 + 尾换行写回），不整份重序列化经宿主专属 saveConfig——避免各宿主 CONFIG_KEYS 差异（dsh 的 provider/reasoningEffort 等）被裁掉。
- **目标判定**：宿主 homeDir 存在（宿主已装）且 `<root>/config.json` 存在（auto-guard 已播种）；未播种跳过并留一行说明，不创建根。
- **Key 传播**：源 = 当前根；无存储 Key 则提示并跳过传播（端点同步照常）。逐根写加密存储，_receipt_ 注明。
- **退出码**：≥1 根成功 → 0；全部失败/无目标根 → 1；参数错误 → 1（usage 行）。
- **dsh 已知限制**：DSH 设置服务在线时以设置层为主存储，config.json 补丁可能被下次设置同步覆盖——spec 记录，不做特殊处理。

## Testing Decisions

- packages/cli 新 spec：seed 临时多根（含伪造 dsh 扩展字段）钉「三键写入 + 未知字段与键序保留」；未播种/未装宿主跳过；--fallback 缺省回落；--propagate-key 的有/无源 Key 两路；usage/退出码。
- conformance cli-equivalence 增两行 usage 钉能力不对称（统一入口含 sync-api、运行时入口不含）+ 一个多根写入行为用例。
- 既有断言零改动，唯二例外：两入口 usage 快照行随新命令组更新（统一入口顶行加 `|sync-api`；运行时入口钉「不出现」）。

## Out of Scope

- 逐根差异化回退（某根保留旧端点）、dry-run、并发锁。
- 交互式 Key 输入（统一入口维持无向导能力面；Key 铺开只做已存 Key 的复制）。
- DSH 设置层的在线写入。
