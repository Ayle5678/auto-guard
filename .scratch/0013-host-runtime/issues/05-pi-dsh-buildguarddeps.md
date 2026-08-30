# 05 —（可选）pi/dsh 复用 buildGuardDeps

What to build:

- host-pi 的 `buildGuard`（src/index.ts）、host-dsh 的 `createState` 接线改调 host-runtime 的 `buildGuardDeps`；会话态实现（内存）与审计实现选择仍归各宿主。
- conformance 若残留本地组装一并对齐。

Blocked by: 01

Status: done（2026-08-30 顺手完成：与 02–04 共享同一 buildGuardDeps，无额外风险）

Acceptance:

- [x] pi/dsh 测试与冒烟全绿，行为零变化
- [x] 仓内 grep `new GuardService`/GuardDeps 字面接线只剩 host-runtime 一处
