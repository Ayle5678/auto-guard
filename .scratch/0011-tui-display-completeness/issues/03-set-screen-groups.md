# 03 — set 屏动作小节分组：密钥 / API 端点 / 偏好 / 维护

**What to build:** set 屏动作列表按四个带标题的小节分组：密钥（查看 / 设置向导 / 清除）→ API 端点（地址 / 模型 / 重置）→ 偏好（**界面语言**、历史层）→ 维护（重载说明）。组标题为非选中分隔行，光标移动自动跳过、Enter/Space 不作用于标题；危险动作 `⚠` 前缀与既有 hint 显示保持。语言不再视觉上落在密钥/API 设置区。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 无头断言：组标题行按序渲染（密钥→API 端点→偏好→维护），语言项位于偏好组
- [x] 无头断言：光标上下移动跳过标题行；在组边界处 Enter 命中正确的下一可选项
- [x] 危险动作（清除密钥）确认对话框流程不回归
- [x] 双语（zh/en）全绿；`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿
