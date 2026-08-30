# 01 — 抽运行时并切 zcode

What to build:

- 新包 `packages/host-runtime`（`@auto-guard/host-runtime`，仅依赖 `@auto-guard/core`，零宿主 SDK，Node 内置模块）：
  - 从 host-zcode 抽：hook 管线（hook-cli 主流程、session-start、bootstrap 组合根）、管理 CLI（cli.ts 全量，含 ADR-0011 四层语言、`set set-lang` 交互向导）、输出序列化（hook-output）、config/capabilities 接线。
  - 唯一入口 `createHookHost(descriptor): { hookMain, sessionMain, cliMain, emit }`；`buildGuardDeps` 单独导出（05 票的 pi/dsh 入口）。
  - `HostDescriptor` 类型：hostId、configDir、guardedToolNames（含合成映射项，如 qoder `delete_file`→bash/`rm`）、pathFields/contentFields 防御链、envNames（会话/工作区）、capabilities、wire 序列化器槽（默认实现 = 现 zcode/claude/qoder 同款 `hookSpecificOutput` 形）、可选 catalog 扩展。
  - 共享 hook 宿主文案目录（zcode 现 ~118 键平移为运行时默认目录）。
- host-zcode 改为薄门面：`src/descriptor.ts`（zcode 描述符：ApplyPatch→edit、`~/.zcode` 根、ZCODE_* env 名）+ 入口文件重导出 createHookHost 产物；**dist 文件名与路径不变**。
- 运行时参数化契约测试框架就位（fail-closed 阶梯先参数化 zcode 一行，后续票补三宿主）。

Blocked by: —

Status: done

Acceptance:

- [x] host-zcode 切换前后行为逐字节一致：conformance 全绿 + 样例 payload（allow/deny/ask/坏输入）输出 diff 为空
- [x] `createHookHost(zcodeDescriptor)` 冒烟：stdin payload → 与旧 dist 同款 JSON
- [x] 运行时契约测试框架可参数化跑描述符（zcode 行绿）
- [x] installer profile 路径零改动；`scripts/smoke/` 各脚本不受影响；三门禁全绿
