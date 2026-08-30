# 02 — claude/qoder 切换

What to build:

- host-claude、host-qoder 退化为「描述符 + dist 入口重导出」门面（对齐 01 的 zcode 形态）：
  - claude 描述符：`NotebookEdit→edit`、`notebook_path`/`new_source` 字段拼写、`~/.claude` 根、CLAUDE_* env 名。
  - qoder 描述符：9 拼写映射 + `delete_file`→bash/`rm` 合成（SPEC 0012 已落地行为）、`~/.qoder` 根、QODER_* env 名。
- 语言层补齐：两宿主硬编码中文串（hook-cli fail-closed 文案、hook-output `DELETION_RETRY_HINT` 等）换运行时目录取词，随四层解析。
- 删除两宿主内被运行时吸收的文件（cli.ts/hook-cli.ts/bootstrap.ts/hook-output.ts/session-start.ts/config.ts 本体），宿主测试收敛为描述符形状 + 重导出正确性。

Blocked by: 01

Status: done

Acceptance:

- [x] conformance 全绿；qoder≡claude 序列化逐字节 pin **仍然绿**（迁移检查点）
- [x] 默认语言（zh 兜底）下 claude/qoder 样例 payload 输出与切换前逐字节一致
- [x] `set lang en` 后两宿主 fail-closed/提示文案为英文（新行为，修 ADR-0011 漂移）
- [x] delete_file 合成行为在 qoder 门面下不回退（SPEC 0012 断言仍绿）
- [x] 三门禁全绿
