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

## Comments

### 2026-08-30 实施票 01–03 时顺带取得的 mac 数据点（darwin arm64，非人验结论）

- **测试套件**：全仓 903 个测试首次在 mac 全量通过（此前仅在 Windows 跑过）；修了两类测试平台适配——core 的 Remove-Item 用例与 opencode / conformance 夹具的 `D:` 盘符路径（POSIX 上 `path.isAbsolute` 不认盘符，被 join 进 workspace；产品代码对两平台各自的真实输入均正确，属夹具问题）。
- **原生依赖**：`better-sqlite3-multiple-ciphers@13` 在本机 darwin arm64 + Node 24 源码编译成功，`audit-sqlcipher.spec` 12 用例全过——但这是本机编译，**不等于 npm 有 darwin 预编译发布**（该问项仍需人验：npm 平台矩阵查询 + 无预编译时的 LightAuditStore 降级实测）。
- **Node 下限**：22.18.0 / 22.17.1 / 20.19.5 三版本实测数据见票 01（对 TUI / 宿主项无人验影响，但完整链路 clone→install→build→init 已在本机走通，pnpm 需经 corepack）。
- 未覆盖（仍需人 + GUI 实测）：Qoder / ZCode mac 配置位置、dsh / pi mac 安装可用性、claude / opencode PATH 检测命中、Claude Code hook shell 行为、Terminal.app / iTerm2 的 TUI 实测。

Acceptance:

- [ ] 六项各有结论回写 Comments（含证据：路径存在性截图/输出、版本号）
- [ ] 支持矩阵措辞按结论升格（README / docs，联动 03 票）
- [ ] 发现的宿主路径差异开后续工单收口
