# 01 — 密钥屏「统一评审 API」动作：三步输入链 + 确认框

**What to build:** 密钥屏 API 端点组加 `sync-api` 行（ActionItem.ask，owner `sync-base`，预设当前根 apiBase）；resolveInput 链 `sync-base` → `sync-model`（预设当前根 model）→ `sync-propagate`（y/N）；AppState.sync 累加器跨步携带 base/model，Esc/开链清空；空提交保持输入框 + syncRequired notice；末步开确认框（danger=false，message 含 base/model/传播说明），pending = `['sync-api', base, model]`（y 开头加 `--propagate-key`）。i18n zh/en 新键（actSyncApi、syncInputBase/Model、syncInputKey、syncRequired、confirmSyncApi、syncKeyLine）；help.ts 命令对照表补 sync-api 行。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 动作行 + 三步输入链 + 累加器 + Esc/空值路径
- [x] 确认框 → runCli 执行（argv 不含 --config-root，回执与命令行一致）
- [x] i18n 双语键 + help 命令对照；app.spec 新用例全绿；既有断言唯一改动：set 屏组内位移用例随新行改索引（7→8 起点、9→10 落点），意图不变

## Comments

- 2026-09-27 实装后用户在 TUI 看不到该行：启动入口是 packages/tui/dist（停留在 09-22 构建），源码改动未编译。已 `npm run build` 重建并用 dist 渲染密钥屏验证「统一评审 API（sync-api，全部宿主）」出现在 API 端点组。提醒：改 src 后需重建 dist，或用 `node packages/tui/src/tui.ts` 直跑免构建。
- 2026-09-27 用户反馈改名：TUI 行标签「统一评审 API（sync-api，全部宿主）」→「复制API到其他host（sync-api）」（en: Copy API to other hosts (sync-api)）；usage.md 两处 TUI 提法同步；CLI 命令名与 §3.5 手册标题不变。
