# 平台支持：Windows 与 macOS 双平台；跨平台是代码纪律，不是移植项目

auto-guard 在 Windows 上开发，但产品代码自始跨平台：全部配置根经 `os.homedir() + path.join` 构造；宿主配置模板在**安装期**替换为字面绝对路径（不依赖运行时 shell 展开，`${AUTO_GUARD_*}` 是模板占位不是环境变量语法）；全仓唯一 `shell: true` 是 Windows 的 DEP0190 规避且带无 shell 的 POSIX 分支；加密纯 `node:crypto`（无 DPAPI/注册表，`.machine.key` 模式 0o600 在 mac 是真实权限）；唯一原生依赖在 `optionalDependencies` 且加载失败自动降级 LightAuditStore（`audit.ts:390`）；TUI 纯 ANSI（macOS Terminal / iTerm2 均支持所需特性）。2026-08-30 的 mac 兼容性审计逐文件确认上述纪律成立，无硬编码盘符、无 CRLF 写出、无 Windows 专属 API。

支持档位：**Windows + macOS 双平台**。v1 = 修复审计发现的四个疏漏（smoke-zcode 的 HOME 缺失、`engines >= 20` 低于实际下限、docs 无 mac 章节、README 双声明不准）+ 机会性真机验证（Qoder / ZCode 的 mac 配置路径、darwin 预编译、Terminal.app 按键行为）；验证结果回写文档之前，macOS 在对外文档标注为「代码审计通过、真机验证中」。Linux 不承诺也不禁止（同为 POSIX 路径与回退，无验证）。

## Considered Options

- 声明 Windows-only：拒绝——跨平台纪律已在代码里成立，放弃 mac 无对价；AI 编码工具用户中 mac 占比不可忽视。
- 全面 mac 验证（mac CI、全宿主真机矩阵）：拒绝（现阶段）——宿主在 mac 的配置位置（Qoder 尤甚，Electron 应用常在 `~/Library/Application Support/`）与 darwin 预编译可用性是未知事实，成本前置不理性；机会性验证先行，事实回写后再评估升格。
- 静默 best-effort、文档不提 mac：拒绝——`engines >= 20` 低于实际下限（bin 为 TS 直跑需 type stripping、`node:sqlite`、原生可选依赖 ≥22），Node 20/21 用户在任何平台都会在 `init` 硬失败，文档必须诚实。

## Consequences

- 平台纪律进入 code-review 检查项：win32 分支必须有 POSIX 回退；路径只许 `homedir() + join`；安装器写值为安装期字面路径；新增原生依赖必须 optional + 可降级。
- `engines` 下限以实测钉死（候选 Node 22.18：type stripping 默认开启与 `node:sqlite` 无标志的较大者；SPEC 0014 工单 01 落实），全包 package.json 与 README 双语同步。
- mac 真机验证为持续性事项（SPEC 0014 工单 04，需人）：Qoder / ZCode 的 mac 配置路径若与现 profile 不同，开后续票补 profile 检测路径，不回改本 ADR。
- TUI 终端矩阵文档补 macOS Terminal / iTerm2；Terminal.app 的 Option 键默认 ESC 前缀行为记录为已知事项（日常导航键不受影响）。
