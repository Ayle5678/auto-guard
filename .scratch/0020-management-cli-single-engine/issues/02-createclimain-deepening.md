# 02 — createCliMain 深化：能力声明 + 真实变量点 + 程序名

**What to build:** 宿主运行时的 createCliMain 深化为唯一 dispatch/渲染/退出码/usage 引擎：CliParts 增能力声明（命令组开关：本驱动含 ask 组与 set-key 向导、无聚合状态）、根解析模式（描述符钉根）、输出 sink、程序名（usage 前缀参数化）。运行时驱动自身先迁移到深化后引擎（自食其力第一步）——其命令面逐字节不变，快照断言全绿。

**Blocked by:** 01（先钉后动）.

**Status:** resolved

- [x] 能力声明字段就位；运行时驱动声明现状能力集
- [x] 程序名参数化（usage 前缀不再内嵌）
- [x] 运行时 CLI 行为快照逐字节绿
- [x] 三门禁 + conformance 全绿
