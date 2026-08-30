# 0009 — Issue 07：i18n 目录 + 帮助屏 + 文档接线

What to build:
- `src/i18n.ts`：TUI 铬件双语目录（zh/en，per-package catalog，ADR-0011）；语言解析复用 core 四层（`envLang`/`effectiveLang`/`readMachineLang` + 当前根 `config.lang`）。
- 帮助屏（屏 8）：键位表；**每屏动作 ↔ 等价 CLI 命令对照表**（覆盖面自证的清单）；非 TTY 提示文案的出处同目录。
- 文档接线：根 README 包列表加一行 `@auto-guard/tui`；`docs/cli.md` 顶部加 TUI 入口说明（`auto-guard-tui` / `node packages/tui/dist/tui.js`）；`docs/usage.md` 加一节「TUI 控制台」含截图位（可先文字描述）；`README.zh-CN.md` 同步。
- CONTEXT.md 词条已在 spec 阶段落盘（TUI 控制台 / 帧渲染器 / 命令模式），本票核对引用一致。

Blocked by: 03
Status: done

Acceptance:
- [x] `AUTO_GUARD_LANG=en` / 机器默认 / 根 config 三条路径语言正确，`set lang` 即时跟随
- [x] 帮助屏命令对照表覆盖 spec 命令面清单全部条目
- [x] 文档四处更新且与实际 bin/路径一致
- [x] 目录单测（key 完整性：zh/en 键集相等）

## Comments

- 2026-08-30: 完成。src/i18n.ts 双语目录（键集由 TS 强制对齐）；语言解析复用 core 四层（单测覆盖 env/config/machine-zh 兜底）；帮助屏键位表 + 全命令对照表；README/README.zh-CN/docs/cli.md/docs/usage.md §6 已接线。
