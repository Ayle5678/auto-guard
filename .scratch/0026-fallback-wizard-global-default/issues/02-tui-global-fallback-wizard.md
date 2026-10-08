# 02 — TUI 备用三步向导 + 全局写入所有宿主根

**What to build:** `WizardState`/`WizardInput` 加 `slot`；`openWizard(state, slot)` 按槽位取预设与文案（wizFb*）；`ActionItem.wizard` 扩为 `boolean | 'fallback'`，「设置备用密钥」动作改为 `wizard: 'fallback'`；复核行/校验共用主向导管线（validateWizard 不变）。`saveFallbackWizard(input, lang, deps)`：按 PROFILES 遍历（宿主已装 + config.json 存在），base/model 非空则 `applySetApi` 写入，key 一律 `saveFallbackApiKey`，回执逐根 `✓ <label> → config.json`。tui.ts wizard Effect 按 slot 分派；删除单步 `fallback-key` owner 与 `saveFallbackKey` Effect。

**Blocked by:** 01。

**Status:** resolved

- [x] 向导 slot 化：三步链/掩码输入/复核/校验错误复用
- [x] 全局保存 + 未播种/未安装根跳过 + 空值保留现值
- [x] i18n wizFb* 双语；fbKey* 单步键清理
- [x] app.spec 向导流程两用例 + actions.spec 全局保存两用例全绿

## Comments
