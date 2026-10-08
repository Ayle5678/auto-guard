# 03 — CLI + TUI 管理面

**What to build:** core `applySetApi` 增 `fallback-base|fallback-model` 子命令（reset 同时复位 fallbackApiBase）；guard-surface 目录 +9 键（setFallbackKey*×4、showFallbackKey*×4、clearFallbackKeyDone）。CLI：`set set-fallback-key`（readHidden 单步，非 TTY exit 2）、`set clear-fallback-key`、`set show-key` 备用槽两态行（仅 fallbackApiBase 非空时）、setUsage 文案。TUI：密钥屏密钥组 +「设置/清除备用密钥」（设置走 masked 单步输入 + `saveFallbackKey` Effect 直存；清除 danger 确认框 runCli），API 组 +「备用 API 地址/模型」ask 动作（runCli set set-api fallback-*）；i18n 双语 + help 命令对照。

**Blocked by:** 01、02。

**Status:** resolved

- [x] applySetApi 扩展 + setApiUsage 双语文案
- [x] CLI set-fallback-key/clear-fallback-key/show-key 增行
- [x] TUI 动作/owner/Effect/i18n/help；密钥不经 argv（Effect 直存）
- [x] 防漂移 pin 有意更新：CANONICAL_KEYS、DSH PINNED_DEFAULTS、conformance setUsage ×3、TUI set 屏索引
- [x] commands.spec / TUI app.spec 新用例全绿

## Comments
