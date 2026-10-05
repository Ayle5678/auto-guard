# 01 — 删除分级数据与判定：directoryDeletePolicy 纯模块

**What to build:** 新的纯函数分级模块：输入删除目标集合与 workspace，输 出 轻量/标准/严格 三级之一——严格（任一目标命中敏感路径、或根邻近〔盘根/家目录之下 ≤`strictMaxDepth` 默认 2 级〕、或规模 ≥`largeMinFiles` 默认 1000 / ≥`largeMinBytes` 默认 500MB）；轻量（全部目标在 workspace 或系统临时区子树内，且 basename 命中可再生名〔`__pycache__`/`node_modules`/`.pytest_cache`/`.mypy_cache`/`.ruff_cache`/`*.egg-info`〕或规模 ≤`trivialMaxFiles` 默认 200 且 ≤`trivialMaxBytes` 默认 50MB）；其余标准。全部阈值住 defaults 顶层 `directoryDeletePolicy` 数据字段（ADR-0013 补齐语义）。规模扫描封顶即判（计数到大规模阈值即停、超限即"大"）；名字命中免扫描；多目标取最严；stat 失败（不存在/无权限）保守按目录落标准；全部目标 stat 为普通文件输出独立信号（供 02 回落普通管线）。模块零 LLM、零网络，node:fs stat/readdir 实现（ADR-0002 零依赖不变）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 边界单测：恰好 200 文件、恰好 1000 文件（封顶即停的计数断言）、盘根一级、家目录下二级/三级、临时区内/外、可再生名命中（含嵌套路径 basename）、stat 失败降标准、文件+目录混合取最严
- [ ] 多目标最严、复合命令跨段目标并集
- [ ] 规模封顶扫描在大目录（fixture 数万条目）上毫秒级返回（封顶路径不走完）
- [ ] policy 字段缺省/部分缺省时全量回退标准级（存量安装零行为变化直到 02 接线）
- [ ] Windows 盘根/大小写折叠与 POSIX 根各有用例

## Comments

- 与 03（剥壳）无阻塞但协同：剥壳让 powershell 包裹的删除也能提出目标，从而进入本模块分级。
