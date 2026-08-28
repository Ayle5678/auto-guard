# pnpm workspace 单仓合并三宿主，不再复制移植

三前代项目（dsh→pi→zcode）每代都靠"复制核心 + 换适配层"演进，zcode ADR-0001 已记录两份核心手工同步的税。本仓库用 pnpm workspace 收拢：`packages/core`（零宿主依赖的裁决引擎）+ `packages/host-dsh` / `packages/host-pi` / `packages/host-zcode`（薄适配层，各自保留原生打包形态）+ `packages/cli`（管理 CLI 与安装器）。跨宿主改动一次提交同步全部宿主，同时不打断各宿主的分发渠道（dsh 插件、pi jiti 入口、zcode dist 构建）。

**Status**: accepted，2026-08-28。Supersedes zcode-auto-guard ADR-0001（copied-core-not-shared-package）与 pi-auto-guard ADR-0001（independent port）——两者"推迟共享"的前提（宿主尚未稳定）已消失。

## Considered Options

- 独立共享 npm 包 + 三个宿主仓库：一次改动变三次发布，版本漂移正是复制模式的病根。
- 单包多入口：dsh 的 peerDependencies（@deepseek-ai/*）会污染 zcode 的零依赖约束。

## Consequences

- 三个旧仓库冻结归档，README 指向本仓库；统一后起始版本 0.3.0。
- 前代 tests 一并迁移（core 测试三库同源可合并，宿主适配层测试各自保留）。
