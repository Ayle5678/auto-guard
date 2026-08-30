# 01 — 语言解析基础设施 + 管理 CLI 双语

**What to build:** 用户运行 `auto-guard set lang en` 后，当前宿主配置根记住英文；此后管理 CLI 的全部输出（用法、guard/set/examine/optimize、状态视图）为英文，`guard status` 显示生效语言，LLM 裁决理由开始以英文落库——中文用户什么都不做则一切如旧。语言四层解析（env > 每宿主 config > 机器默认 `~/.auto-guard/config.json` > 中文兜底）在本票内成为 core 能力：取词 helper 进 core，安装器目录留在 cli、取词改用 core helper。机器默认文件只认 `lang` 字段、路径可注入；`[删除理由]` 标记与解析原样不动。

**Blocked by:** None — can start immediately

**Status:** done（2026-08-30 核对：ADR-0011 功能已全量落地——core 四层解析、各包目录、`set lang`、安装器机器默认与 conformance 语言等价均有现行测试在库）

- [x] 四层解析矩阵测试逐层验证；机器默认文件路径注入临时目录
- [x] `set lang en` 后配置根持久化 `lang`、回执为英文；`zh` 同理；未知值报错并列出可用值
- [x] `guard status` 显示生效语言：单根视图一行；聚合视图按宿主各显示一行（各根语言可不同）
- [x] 审查提示词按 config.lang 携带理由语言指令（fake reviewer 捕获断言）
- [x] core 引擎消息（状态/历史/优化/通知/来源标签等全部用户可见文案）en 金路径断言
- [x] 存量中文断言测试不改一字全部通过（zh 兜底契约）
