# 03 — opencode 切换

What to build:

- host-opencode 的 hook-cli/bootstrap/config/cli/hook-output 主体收进运行时；差异落描述符：
  - wire 序列化器槽注入 `{status,reason}` 契约 + `parseVerdict`/`statusToReply`（替换默认 `hookSpecificOutput` 形）。
  - `GUARDED_PERMISSION_TYPES`（bash/edit/read 权限面）进描述符数据。
- **留宿主侧不动**：plugin.ts 总线接线（event hook 监听 `permission.asked` + `client.permission.reply`）、`SeenRequests` 防重放、`payloadFromAsked`/`payloadFromSdkPermission`、opencode-plugin-types。
- 语言层补齐同 02（fail-closed 文案换目录取词）。

Blocked by: 01

Status: done

Acceptance:

- [x] conformance 全绿（opencode 行）；plugin → spawn hook-cli → reply 链路冒烟不变（ADR-0015 修订后的机制）
- [x] 默认语言下输出与切换前逐字节一致；`set lang en` 后文案为英文
- [x] `plugin/` 产物路径不变，installer `resolvePackagePaths` 零改动
- [x] 三门禁全绿
