# 01 — conformance 钉两 CLI 行为快照

**What to build:** 动工前的安全网：conformance 为统一管理 CLI 与宿主运行时 CLI 各钉一份当前行为快照——命令分发（guard/set/examine/optimize 全动作）、usage 输出、退出码表逐值（0/1/2 语义）。重构在绿灯下进行，未来两入口的任何行为漂移都会红。纯加测试，零生产代码改动。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 两 CLI 全动作行为快照断言（命令 → 输出 → 退出码）
- [x] 各入口独有能力（cli 聚合状态、运行时 ask 组与向导）同样入快照——今天的漂移面被如实钉住
- [x] 零生产代码改动；三门禁全绿
