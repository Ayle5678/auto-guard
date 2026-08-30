# 0010 — Issue 01：导航与反馈——全局方向键切屏 / 安装子页 Tab / notice 系统

What to build:
- `app.ts` `reduceKey`：`←` / `→`（及 `h` / `l`）全局切屏——沿 `SCREEN_ORDER` 循环，效果与数字键一致（`refresh`）。输入框 / 对话框 / 向导 / busy 的既有接管顺序不动。
- 安装屏 `installerKey`：子页切换从 `←→/hl` 改绑 `Tab` / `Shift+Tab`（`key.name === 'tab'` + `shift` 标志；`keys.ts` 的 KeyEvent 已带 shift）。
- notice 系统：`AppState.notice?: string`；切屏（含数字与方向键）、`r` 刷新、总览换根、确认取消、未勾选宿主等非命令动作设置 notice；**任何下一次按键事件清除**（零定时器）；`render` 时 footer 左侧以 notice 替换键提示（强调色）。
- footer 键提示文案改写：`←→ 切屏 · ↑↓ 选择 · Enter 执行 · : 命令 · r 刷新 · q 退出`（zh/en 同步，`1-8` 旧文案消失）。
- 帮助屏键位表改写到 100% 准确：`←→/hl` 切屏、`Tab/Shift+Tab` 安装子页、`1…8` 跳转、其余行保持。
- i18n：新增 / 改动串全部 zh/en 成对。

Blocked by: —
Status: done

Acceptance:
- [x] 无头断言：dashboard 按 `right` 切到 guard（页签 index=1、effect refresh）；`left` 从 dashboard 环绕到 help；guard 屏 `h`/`l` 不再误触列表
- [x] 无头断言：安装屏 `tab`/`shift+tab` 换子页；←→ 不再换子页
- [x] reducer 单测：切屏后 notice 置位；下一次按键（任意键）清除；footer 渲染 notice 文案
- [x] `pnpm -r typecheck` / `pnpm -r test` 全绿

## Comments

- 2026-08-30: 完成。reduceKey 顶部统一清 notice；←→/hl 全局切屏（stepScreen 环绕，refresh + autoload），数字降级跳转快捷键；安装子页改绑 Tab/Shift+Tab（installerKey），←→ 不再触碰子页；notice 渲染于 footer 左侧 accent 段（下一次按键即清，零定时器）；切屏/刷新/换根/取消确认均有提示；footer 键帽文案与帮助键位表改写（←→ 切屏、Tab/Shift+Tab 子页、1-8 跳转）。断言：app.spec arrow-key/notice 块 + installer.spec tabs 用例。
- 2026-08-30（code-review 修复轮）: Spec 审查补漏：安装屏 apply/remove 零勾选改走 footer notice（instNoneChecked），原写入预览面板的做法废弃（测试同步）；死键 hintJump/hintBusy 从双语目录移除。
