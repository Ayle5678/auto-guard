# 03 — conformance 接入

What to build:
- `packages/conformance/`：宿主等价性矩阵与 fail-closed 矩阵增 `qoder` 行（镜像 claude 行，声明差异点：双命名工具集、无 NotebookEdit、配置根 `~/.qoder/auto-guard/`）。
- fail-closed-ladder 用例钉死 qoder：守卫进程崩溃 / payload 不可解析 → **ask 级**输出（`permissionDecision: "ask"`），不得 deny 硬阻断、不得静默放行。
- 三态输出等价用例：allow（空 stdout）/ deny / ask 与 claude 逐字段同构断言（同一 Decision 输入，qoder 与 claude 的 stdout JSON 除包名外应一致）。

Blocked by: 01, 02
Status: done

Acceptance:
- [x] conformance 全量跑过（含 qoder 行，72 tests）
- [x] fail-closed-ladder 覆盖 qoder 崩溃/坏 payload 两分支（host-qoder 包内 8 例 + conformance qoder ladder）
- [x] qoder-claude 输出同构断言存在且通过（`qoder and claude serialize the same decision to byte-identical stdout JSON`：allow 静默/deny/ask 三态同输入逐字节一致）

## Comments

### 实施结论（2026-08-29）

- code-review（Spec 轴）指出初版只写了坏 payload 分支、缺三态同构断言——已补 `qoder↔claude serialize` 三态逐字节等价用例；崩溃分支的序列化级断言在 host-qoder 包的 8 例 ladder（claude 同款分工，与先例一致）。
