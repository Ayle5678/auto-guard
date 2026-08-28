# 05 — 语言等价性保障与文档收尾

**What to build:** 用户获得的全产品双语是可信的：conformance 增加跨宿主「语言不影响裁决」断言（同一请求在中文/英文配置下裁决一致，仅理由语言不同）；docs/cli.md、docs/usage.md 与两份 README 反映新的命令面（`set lang`、生效语言行、四层解析顺序、「安装选一次一直用」）；全仓测试与 typecheck 绿，真实 CLI 冒烟（英文机器默认 / 中文 / env 覆盖）符合预期。

**Blocked by:** 01、02、03、04

**Status:** ready-for-agent

- [ ] conformance 语言等价断言通过
- [ ] 文档与实际解析顺序、命令面一致（flags 表人工核对）
- [ ] 全仓测试与 typecheck 绿；三种场景冒烟通过
