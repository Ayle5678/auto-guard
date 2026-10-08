# 0028 — 删除分级：三级门 + 剥壳修复

> Status: resolved
> 决策依据：ADR-0012（递归删除不变式：分类优先序冻结，分级以数据表达、只改流内处置）、ADR-0027（本 spec 落的删除分级决策）、ADR-0013（顶层字段补齐语义：policy 块可到达存量安装）、ADR-0021（删除流单次复审纪律）、grill-log 2026-10-05 两轮。

## Problem Statement

目录删除复核对一切递归删除无差别执行"首击拒 + 理由协议 + 单次复审"：近 30 天 143 次删除流决策中 80 次是首击要理由、11 次是理由协议没接上——约三分之二是纯协议往返。其中约一半目标是可再生缓存（`__pycache__`、node_modules）或 agent 自建的小临时目录（`_check`、`_frames`、Temp 下构建目录），与 C 盘 9.35GB 备份目录走完全相同的重流程；另一端，workspace 外的根邻近大目录（如盘根下一级）LLM 复审说 allow 即放行，无人工关口。另有一处实际断点：powershell/cmd 包裹的删除在重试邻居匹配中提不出删除目标（目标提取只认段首删除词），理由反复贴不上——9 月 30 日 `miniforge3_old` 六连拒实录。

## Solution

删除流入口先对目标做 stat 信号分级，三级处置：**轻量**（workspace 或系统临时区内，且命中可再生缓存名或小规模）免理由协议、直接普通评审；**标准**（默认）维持现行理由协议不变；**严格**（敏感路径 / 根邻近 / 超大规模）理由协议照走、high 推理复审、结论上限收为人工确认——LLM 无权独自放行。目标 stat 全为普通文件的删除回落普通管线。同时修复剥壳：目标提取前剥掉 powershell/cmd 包装、内层按语句拆分提目标，使重试邻居匹配可靠接上。

## User Stories

1. 作为用户，agent 清理它自己创建的测试小目录（`_check`/`_frames`/渲染缓存）不再被要求提供删除理由，所以制作/渲染循环不再每个目录多两轮往返。
2. 作为用户，`rm -rf __pycache__`、node_modules 等可再生缓存删除直接走普通评审放行，因为它们删了会再生。
3. 作为用户，agent 删盘根/家目录下浅层大目录（如 `D:\` 下一级）时，即使 LLM 复审说 allow 也必须经我确认，所以高层大目录永远过一次人的手。
4. 作为用户，workspace 外的小目录（如配置漂移产生的临时产物）维持现有理由协议，行为既不回退也不莫名加严。
5. 作为用户，系统 Temp 区里 agent 自建的小目录享受轻量处置，因为临时区本来就是即弃区。
6. 作为用户，powershell 包裹的 Remove-Item 被拦后带 `[删除理由]` 重试一次就能接上协议，不再循环贴理由。
7. 作为用户，`rm -rf 某文件`（目标是文件不是目录）不再进删除理由协议，回归普通评审；`rm -rf .env` 这类敏感路径仍被敏感路径门拦下。
8. 作为用户，目录不存在或 stat 失败时删除按标准流程保守处理，所以异常路径不会被更松的级别放行。

## Implementation Decisions

- **分级信号与判序**（严格信号先判，全部可配）：
  1. **严格**：任一目标命中敏感路径；或根邻近——位于盘根或用户家目录之下不超过 `strictMaxDepth`（默认 2）级；或规模超上限——文件数 ≥ `largeMinFiles`（默认 1000）或总字节 ≥ `largeMinBytes`（默认 500MB）。
  2. **轻量**：全部目标在 workspace 内**或系统临时区子树内**，且（basename 命中可再生名，或规模 ≤ `trivialMaxFiles`（默认 200）且 ≤ `trivialMaxBytes`（默认 50MB））。
  3. 其余为**标准**：现行流程原样（理由协议 + 低推理单次复审 + 非 allow 转人工）。
- **可再生名清单**（defaults 数据字段）：`__pycache__`、`node_modules`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`*.egg-info`。名字命中即轻量、不做规模扫描。
- **规模扫描封顶**：文件计数与字节累计到大规模阈值即停——超限即判"大"，天然免去数完 node_modules 式目录（封顶值即判定值）。
- **多目标取最严**（restrictive first 既有纪律）；复合命令跨删除段同理。
- **stat 失败**（目标不存在/无权限）保守按目录走标准流程，不落更松级别。
- **文件目标回落**（grill Round 2 Q9）：全部目标 stat 均为普通文件（无失败）→ 不进理由协议，回落普通管线（敏感路径门照常先拦）；与 Remove-Item 运行时检测对 file 目标的既有降级语义对齐。
- **轻量处置**：免理由协议，整条命令走一次普通评审；放行写**会话短 TTL** 缓存（复用 always-review TTL 机制，grill Round 2 Q8）——同会话反复清缓存不再复审，但不写跨会话持久缓存（目录内容会变，今日同名判断不代表下周）。
- **严格处置**：理由协议照走 + high 推理档复审（接 `reviewTimeoutBudget` 既有 high ≥30s 分支）+ **结论上限收为 ask**——LLM 的 allow 不生效、转宿主人工确认通道；deny/ask 照常。
- **配置落位**：defaults.json 新**顶层**字段 `directoryDeletePolicy`（各级阈值、深度、可再生名、临时区根），按 ADR-0013 顶层缺失补齐语义可到达存量安装；用户 rules.json 可整体覆盖。
- **B2 剥壳**：目标提取前剥 `powershell`/`pwsh`（含 `-NoProfile` 等任意参数 + `-Command`）与 `cmd /c|/k` 包装（`command <builtin>` 既有）；内层按 `;` 与 `&&` 拆语句逐条提目标。分类层不动——Remove-Item 经运行时 stat 检测入口进流，anchored glob 无需扩展。
- **不变式保持**：分级不改 ADR-0012——递归删除仍必进目录删除流，分级判定发生在流内；轻量级的"免理由协议转普通评审"是流内处置的一种，不是分类层放行。

## Testing Decisions

- 分级判定为纯函数（信号 → 级别），直接单测边界：恰好 200 文件、恰好 2 级深、盘根一级、家目录下二级、临时区内/外、名字命中免扫描、stat 失败降标准、多目标最严、文件+目录混合。
- GuardService seam（stub reviewer + 临时目录 fixture）：
  - 轻量：`rm -rf __pycache__`（fixture 真目录）不出现 needsReason 拒、单次评审放行、会话短 TTL 写回（缓存层断言）。
  - 标准：现行删除流 e2e 用例全绿（回归保护，guard-service.spec.ts 既有删除用例为底线）。
  - 严格：盘根一级目录 fixture → 首击要理由 → 带理由重试 → 复审返回 allow → 最终 kind=ask（收口断言，reviewer stub 强制回 allow）。
  - 文件回落：`rm -rf <file fixture>` 不进理由协议走普通评审；`rm -rf .env` 被敏感路径降级。
  - B2：powershell 包裹 Remove-Item 首击拒 → 同目标裸 rm 带理由重试 → 邻居匹配命中 → 复审（不再二次要理由）；内层 `"Stop-Process …; Remove-Item …"` 多语句目标全提。
- Prior art：guard-service.spec.ts 删除流用例（SPEC 0007/0019 遗产）、directory-delete 模块的历史回归样式。

## Out of Scope

- B3 目标级会话记忆（grill 已拒）。
- 删除理由协议的 UI/文案/标记语法变更。
- 分类层（classifySimple）与 directoryDelete 枚举模式的任何改动。
- `find -delete` 等非 rm 家族删除词的分级推广。
- Windows 之外平台的临时区/盘根语义特判（按 POSIX 根与 `/tmp` 处理，随 ADR-0017 平台支持范围走）。

## Further Notes

- 与 0027 独立实施、互不阻塞；建议顺序 0027 → 0028（先压 ask 总量，再动删除流）。
- 观测验收：30 天窗口删除流决策中协议往返（首击要理由 + 理由未接上）占比从 ~64% 降一半以上；严格级 100% 经人工确认。
- 已知残余（接受）：`powershell -Command "rd /s /q …"`（cmd 内建词包在 powershell 里）分类层不识别删除形态，落 LLM 兜底——比误放行安全，等真实样本再议。
