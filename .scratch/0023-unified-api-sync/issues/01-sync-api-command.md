# 01 — sync-api 命令组：引擎能力门控 + 统一驱动声明

**What to build:** createCliMain 增 `sync-api <base> <model> [--fallback <model>] [--propagate-key]` 命令组（`CliCapabilities.apiSync` 门控，仅统一 CLI 驱动声明）；目标根 = 宿主已装且 config.json 已播种的 hostRoots；定向 JSON 补丁写 apiBase/model/fallbackModel 三键（其余字段与键序原样）；`--propagate-key` 把当前根已存加密 Key 复制到其余根。回执逐根 + 汇总；退出码 0/1。文案键入 shell 目录（zh/en）。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 引擎命令组 + 能力门控 + usage 行；运行时入口不声明（面不扩大，conformance 双向钉死）
- [x] 定向补丁写入：三键 + 未知字段/键序保留（temp+rename 原子写）；未播种/未装根跳过且不创建
- [x] --fallback 缺省回落 model；--propagate-key 复制已存 Key（独立错误域，不污染端点回执）
- [x] packages/cli spec 7 用例全绿；conformance 两行 usage + 多根写入行为用例；三门禁全绿
