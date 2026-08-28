# 0003 — 安装器双语（中/英）

## Spec

外国人运行安装器时面对全中文提示不便。安装器输出改为中英双语：

- 交互式 `init` 进入后先弹双语提问「请选择语言 / Select language」（回车默认中文），此后头图与全部提示跟随所选语言。
- 脚本 / CI 用 `--lang <zh|en>`（接受区域写法 `zh-CN`/`en-US`）或环境变量 `AUTO_GUARD_LANG` 指定；解析顺序 flag → env → 交互提问 → 兜底 `zh`。
- 兜底 `zh` 是硬约束：非交互、未指定语言时输出与历史版本逐字节一致（存量管道 / CI 不破坏）。
- 覆盖面 = 安装器三命令 + init 头图 tagline + 解析错误文案；管理命令（guard/set/examine/optimize）与 core 文案不在本次范围（文案散在 shell 与 core，独立后续迁移，见 ADR-0010）。
- 硬约束沿用 spec 0002：备份、幂等、可还原、profile 之外不写文件（因此**不**持久化语言偏好）。

Design: ADR-0010（扁平消息目录，不用 i18n 库；`sessionNote` 改消息键）。

## Issues

- 01-i18n-catalog-and-lang-resolution.md — 目录 + 语言解析 + `--lang` flag
- 02-bilingual-flows-and-tests.md — 三命令与交互流程接入 + 测试 + 文档

Status: done
