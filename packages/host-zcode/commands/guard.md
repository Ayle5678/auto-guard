---
description: 查看/切换 auto-guard 守卫状态（on/off/status/stats/ping）
---

# auto-guard 守卫管理

使用管理 CLI 查询或切换命令安全守卫的状态。CLI 位于本插件目录下的 `dist/cli.js`（若 `${ZCODE_PLUGIN_ROOT}` 未展开，请在 `~/.zcode/cli/plugins/cache/` 下找到 zcode-auto-guard 的安装目录）。

按用户意图选择并运行对应命令（Bash 执行，向用户转述输出）：

- 查看：`node "<plugin>/dist/cli.js" guard status`
- 开启守卫：`node "<plugin>/dist/cli.js" guard on`
- 停用守卫：`node "<plugin>/dist/cli.js" guard off`
- 数据统计：`node "<plugin>/dist/cli.js" guard stats`
- 测通审查端点：`node "<plugin>/dist/cli.js" guard ping`

用户不带参数时默认执行 `guard status` 并解读给用户听（含无 Key 警告、最近一次裁决）。
