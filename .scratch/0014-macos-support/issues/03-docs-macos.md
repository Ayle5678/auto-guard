# 03 — mac 安装文档 + 终端矩阵

What to build:

- `docs/cli.md`：补 macOS 的 `auto-guard` / `auto-guard-tui` 可执行入口安装法（PATH + `ln -s` 或等价，镜像现有 PowerShell alias 一节的形态）。
- `docs/usage.md:441` 终端要求清单补 macOS Terminal / iTerm2；`docs/usage.md:254` 环境变量示例补 POSIX 形态（`export AUTO_GUARD_LANG=en`）。
- README（双语）平台表述：macOS 标注「代码审计通过（2026-08-30）、真机验证中」——**04 票结论出来前不写「已验证」**；usage.md §5 相关文档补 [ADR-0017](../../docs/adr/0017-platform-support-windows-macos.md) 链接（若本票实施时仍未加）。

Blocked by: —

Status: ready-for-agent

Acceptance:

- [ ] mac 用户按文档能走通 bin 安装指引（形态对齐 Windows 一节）
- [ ] 终端矩阵含 macOS Terminal / iTerm2；环境变量示例双平台
- [ ] 支持状态措辞与 04 票进度一致（未验证前不升格）
