---
description: 管理审查日志与学习规则（examine/optimize）
---

# auto-guard 审查日志 / 学习规则

通过 `dist/cli.js` 管理（路径同 /guard 命令说明）：

审查日志（本地 SQLite + 字段级加密，数据不出本机）：

- `node "<plugin>/dist/cli.js" examine on|off|status`
- `node "<plugin>/dist/cli.js" examine clear-old`（删 30 天前）
- `node "<plugin>/dist/cli.js" examine clear-all`

学习规则（由审计数据离线分析生成 cacheable 模板）：

- `node "<plugin>/dist/cli.js" optimize status|analyze|list|rollback`

执行后把结果用中文转述给用户；`analyze` 需要先开启 examine。
