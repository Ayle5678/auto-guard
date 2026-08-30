# 0010 — Issue 04：视觉打磨——圆角边框 / 页签药丸 / 键帽 footer / 危险 ⚠

What to build:
- `ui/kit.ts`：
  - `panel` / `confirmDialog` 边框圆角化：`┌┐└┘` → `╭╮╰╯`（横竖线字符不变，宽度语义不变）。
  - `navTabs` 药丸化：活动 = accentBg ` 1 总览 `（数字保留），非活动 = muted；间距分隔。
  - `footerBar` 键帽风格：左侧提示拆 seg——键名（bold/亮）+ 说明（muted）；notice 占位时整段 accent；右侧 receipt/spinner 逻辑不变。
- `lists.ts` 动作列表：`danger: true` 的条目文本加 `⚠ ` 前缀（红样式已有）。
- dashboard 列表行 / installer 勾选行跟随新样式（无 emoji，仅既有安全字形集）。
- 全部纯函数改动，CJK 宽度对齐不回退（`text.spec.ts` 照绿）。

Blocked by: 03
Status: done

Acceptance:
- [x] 无头断言：面板首行含 `╭`、末行含 `╰`；对话框同
- [x] 无头断言：页签行活动屏为 ` 1 总览 ` 形态；footer 左侧为键帽 seg 结构（键名 + 说明分离可断言）
- [x] examine 屏 `⚠ ` 出现在 clear-all 行
- [x] `pnpm -r typecheck` / `pnpm -r test` 全绿

## Comments

- 2026-08-30: 完成。panel/confirmDialog 圆角 ╭╮╰╯；navTabs 药丸化（活动 accentBg 双侧留白）；footerBar 改键帽结构（keyHint/hintRow：键名 bold + 说明 muted，notice 占左侧），右回执/spinner 不变；危险行 ⚠ 前缀（随票 02 渲染落地）。顺手修复：滚动槽列在内容不滚动时渲染成 │ 造成「双右边框」观感（0009 预览即有）——改为仅首行显示指示符（↑/┃/↓）、不滚动时留白；inputRow 对以冒号结尾的 prompt 不再追加第二个冒号（命令模式 :: 修复）。帮助屏键位表宽度预算改为整幅，双语描述不再截断。
