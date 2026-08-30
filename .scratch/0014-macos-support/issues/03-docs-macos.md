# 03 — mac 安装文档 + 终端矩阵

What to build:

- `docs/cli.md`：补 macOS 的 `auto-guard` / `auto-guard-tui` 可执行入口安装法（PATH + `ln -s` 或等价，镜像现有 PowerShell alias 一节的形态）。
- `docs/usage.md:441` 终端要求清单补 macOS Terminal / iTerm2；`docs/usage.md:254` 环境变量示例补 POSIX 形态（`export AUTO_GUARD_LANG=en`）。
- README（双语）平台表述：macOS 标注「代码审计通过（2026-08-30）、真机验证中」——**04 票结论出来前不写「已验证」**；usage.md §5 相关文档补 [ADR-0017](../../docs/adr/0017-platform-support-windows-macos.md) 链接（若本票实施时仍未加）。

Blocked by: —

Status: done（2026-08-30）

Acceptance:

- [x] mac 用户按文档能走通 bin 安装指引（形态对齐 Windows 一节）——cli.md 新增「macOS (zsh / bash)」节：Node ≥ 22.18 前提、`chmod +x` + `ln -s` 两个入口到 `~/.local/bin`、PATH 追加、npx 等价用法；ln -s 流程在本机 22.18 实测可跑（bare `auto-guard list` / `guard status` 经 shebang 正常执行）
- [x] 终端矩阵含 macOS Terminal / iTerm2；环境变量示例双平台——usage.md TUI 限制一节补 macOS Terminal / iTerm2；`AUTO_GUARD_LANG` 补 POSIX（`export`）与 PowerShell（`$env:`）双形态（usage.md:254 的 `AUTO_GUARD_CONFIG_ROOT` 本就双形态）
- [x] 支持状态措辞与 04 票进度一致（未验证前不升格）——README 双语安装节新增「平台支持」引注：macOS 代码审计通过（2026-08-30）、真机验证进行中，明确验证结论回写前不标「已验证」；§5 的 ADR-0017 链接实施时已在位（免做）

顺带发现（不在本票范围，留观）：cli.md Windows alias 节指向的 `~/.auto-guard/bin/auto-guard.cmd` 并无任何代码产物对应（安装器不写 bin shim），形态参照时未沿用该路径；后续文档收口时可一并澄清 Windows 侧的真实分发形态。
