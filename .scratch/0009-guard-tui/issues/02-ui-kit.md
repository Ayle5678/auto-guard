# 0009 — Issue 02：渲染组件层——主题 / CJK 宽度 / powerline / 面板 / 对话框 / 内联输入

What to build:
- `src/ui/text.ts`：显示宽度（CJK/全角/emoji 算 2 列）、截断加省略号、左右填充到指定显示宽度——双语对齐的地基。
- `src/ui/theme.ts`：色板（前景/背景/强调/成功/警告/危险 + 分层灰阶），ANSi SGR 封装；`NO_COLOR` 时全部退化为裸文本（接口不变）。
- `src/ui/kit.ts`（纯函数组件，返回 styled 行）：
  - `headerBar`：powerline 风单行头（🛡 标识 · 宿主 · 根路径 · 语言 · on/off 状态点，段间分隔符）；
  - `navTabs`：八屏页签，当前屏高亮；
  - `panel`：带标题的框线面板（`┌─┐│└┘` 单线），内容自适应宽；
  - `listBox`：可选项列表（选中行反显，CJK 对齐）；
  - `scrollArea`：滚动视口（offset + 视口高 + 右侧滚动条字符）；
  - `confirmDialog`：居中确认框（危险动作红色边、Enter 确认 / Esc 取消）；
  - `inlineInput`：内联单行输入（光标模拟、退格、`masked` 模式显示 `•`）；
  - `spinner`：busy 帧序列（`⠋⠙⠹…`）+ 任务文案；
  - `footerBar`：键提示（左）+ 最近回执（右，退出码着色 0 绿 / 非 0 红）。
- 全部纯函数 + vitest 快照/断言（含中文与英文混排对齐用例）。

Blocked by: 01
Status: done

Acceptance:
- [x] 中英文混排行在等宽终端严格对齐（宽度函数覆盖 CJK 基本区 + 全角标点 + 常见 emoji）
- [x] `NO_COLOR=1` 下渲染输出不含任何 SGR 序列且布局不变
- [x] confirm/inlineInput/spinner 各有交互状态机单测（输入 → 状态 → 渲染断言）
- [x] `pnpm -r test` 全绿

## Comments

- 2026-08-30: 完成。src/ui/text.ts（CJK 宽度/截断/换行）+ src/ui/theme.ts（NO_COLOR 退化）+ src/ui/kit.ts（powerline 头/页签/面板/列表/勾选框/确认框/内联输入掩码/滚动条/footer/spinner）。断言覆盖 tests/text.spec.ts、tests/kit.spec.ts、tests/term.spec.ts；spinner 经 footer busy 路径渲染。
