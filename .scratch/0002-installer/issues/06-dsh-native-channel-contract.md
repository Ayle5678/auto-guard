# 06 — dsh 原生通道契约修正（--profile web / link: / auto-guard 身份）

What happened（2026-08-29 诊断）:
- `auto-guard init` 的 dsh 接入必失败：`dsh plugin add <dir>` 报 `error: required option '--profile <name>' not specified`。
- 连锁两处潜在缺陷（只修 --profile 的话 init 会「假成功」，守卫实际永不加载）：
  - host-dsh manifest 未声明 `dsh.bundle.patch` → dsh 的 reconciler 只会把它装成普通依赖，bundles 层栈不含它；
  - 包名/pluginId 与发行文档不一致（differences.md：dsh 插件名为 `auto-guard`），且 `pnpm list` 子串匹配会被旧独立版 `dsh-auto-guard` 假阳性。

Root cause（读 dsh CLI 源码证实）:
- `dsh plugin` 是按 profile 目录转发 pnpm 的薄命令，`--profile <name>` 是它自身的 requiredOption（父级 `--profile` 会被 `rejectParentOptions` 拒绝）；pnpm 结束后按每个依赖 manifest 的 `dsh.bundle` 声明对账 `dsh.profile.bundles`——声明缺失即「装了但不加载」。

What to build（已实施）:
- installer dsh action（profiles.ts）：`plugin --profile web add link:<dir>`、`plugin --profile web remove auto-guard`、`plugin --profile web ls --depth=0 auto-guard`，pluginId `auto-guard`。`link:` 符号链接安装，适配器的 `workspace:*` 依赖仍在 monorepo 内解析（裸目录会让 pnpm 打包并在 workspace 协议上爆炸）；`ls <name>` 按精确依赖名过滤，旧 `dsh-auto-guard` 无法假阳性。
- host-dsh manifest：name → `auto-guard`，新增 `dsh.bundle.patch: ./src/cordis.patch.yml`；cli/conformance 的 workspace 依赖名与 `resolvePackagePaths` 同步改名；README/usage.md 命令示例更新。
- 回归锁：`packages/cli/tests/installer/dsh-native-contract.spec.ts`（argv 形状 + manifest 身份两断言，先红后绿）；profiles/plan/remove-list 三处旧契约断言同步更新。

Blocked by: —
Status: done

Acceptance:
- [x] 真机端到端：`init --host dsh --yes` 成功；web profile 依赖变为 `auto-guard: link:…/packages/host-dsh` 且 bundles 追加 `auto-guard`（先用一次性 profile `ag-e2e-probe` 验证 dsh→pnpm→对账全链，再动 web）
- [x] 旧独立版迁移：`dsh plugin --profile web remove dsh-auto-guard` 后依赖与 bundles 条目一并消失（reconciler 对账），无双重守卫
- [x] 幂等与状态：重复 init 报「已接入，跳过」；`list` 经真实 dsh CLI 报「已接入」
- [x] `pnpm -r typecheck && pnpm -r test` 全绿（26 core + 2 pi + 3 dsh + 3 zcode + 1 conformance + 9 cli 个测试文件）
