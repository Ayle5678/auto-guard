# 04 — 真机验证清单（需人 + 一台 mac）

What to build（验证项，结论逐条回写本工单 Comments 与 spec）:

- **Qoder mac 配置位置**：`~/.qoder/settings.json` 是否存在（Electron 应用常在 `~/Library/Application Support/Qoder/`）——若不同，开后续票补 profile 检测路径（不回改 ADR-0017）。
- **ZCode mac 客户端**：配置是否在 `~/.zcode/cli/config.json`、hooks 结构是否同形。
- **原生依赖**：`better-sqlite3-multiple-ciphers@13` 在 darwin x64/arm64 有无预编译；无预编译时确认降级 LightAuditStore 不崩（audit 实验性、默认关闭，属低风险面）。
- **宿主可用性**：dsh / pi 在 mac 的安装可用性；claude / opencode 的 PATH 检测命中；Claude Code hook 在 mac 的 shell 行为（`node "<绝对路径>"` 引号存活）。
- **TUI 实测**：Terminal.app 与 iTerm2——方向键/Enter/Esc、resize、CJK 对齐、Option 组合键（Terminal.app 默认 ESC 前缀；iTerm2 可配）。
- **完整链路**：clone → pnpm install → build → `auto-guard init` → `guard ping` → TUI 启动。

Blocked by: —

Status: ready-for-human

Acceptance:

- [ ] 六项各有结论回写 Comments（含证据：路径存在性截图/输出、版本号）
- [ ] 支持矩阵措辞按结论升格（README / docs，联动 03 票）
- [ ] 发现的宿主路径差异开后续工单收口
