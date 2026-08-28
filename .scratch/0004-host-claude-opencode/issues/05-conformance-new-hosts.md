# 05 — conformance：两新宿主等价性与 fail-closed 矩阵

What to build:
- `packages/conformance` 增 claude / opencode 适配器用例：
  - 跨宿主决策等价：同一 GuardRequest 在 dsh/pi/zcode/claude/opencode 五宿主得出同 kind/risk/来源（沿用既有等价性测试模式）。
  - fail-closed 矩阵：不可解析 payload（claude→unreviewable→ask；opencode→status 不改写落 TUI）、守卫进程崩溃（claude catch-all→deny 级；opencode 插件不 throw）、宿主 ask 兜底路径。
- 真机冒烟脚本（沿用既有 real-smoke 模式）：claude hook 样例 payload、opencode hook-cli 样例。

Blocked by: 01, 03
Status: done

Acceptance:
- [x] 五宿主等价性测试绿
- [x] fail-closed 矩阵全绿
