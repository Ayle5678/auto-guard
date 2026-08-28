# 01 — Monorepo 骨架

What to build:
- pnpm workspace：`packages/{core,host-dsh,host-pi,host-zcode,cli}` 五包 + 根 `pnpm-workspace.yaml`。
- 根 tsconfig（TS ESM、strict）、vitest 工作区配置、`pnpm -r typecheck/test/build` 脚本。
- 各包 package.json：`@auto-guard/core|host-dsh|host-pi|host-zcode` + cli 包 bin `auto-guard`；core 的 `better-sqlite3-multiple-ciphers` 声明为 optionalDependencies。
- `LICENSE`（MIT，沿用前代）、`.gitignore`、`AGENTS.md` 已在。
- git 仓库初始化与首次提交。

Blocked by: 无
Status: done

Acceptance:
- [x] `pnpm install && pnpm -r typecheck && pnpm -r test` 在空包集上通过
- [x] 五个包均能被 workspace 解析，无幽灵依赖
- [x] core 的 optional 依赖不出现在 host-zcode 的依赖树

## Comments

- 2026-08-28: done — pnpm workspace green on empty set; five packages resolve; cipher dep only under core; git initialized
