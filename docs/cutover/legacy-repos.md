# Legacy repository cutover (maintainer checklist)

The three predecessor repos freeze at their last released versions. Executing the archive is manual; this document provides the exact text and steps.

## Steps

1. In each legacy repo, prepend the banner below to `README.md` (and `README.zh-CN.md` where present).
2. Push a final commit; mark the repo archived in the hosting UI (disables issues/PRs, keeps code readable).
3. If a package is published to a registry, publish one final patch version carrying only the banner README, so `npm view` points readers here.
4. No data migration needed anywhere: config roots are unchanged, so users' rules/caches/audit data are reused in place by the unified package.

## Banner (English)

> **⚠️ Archived — merged into [auto-guard](../auto-guard).**
> This project is now the `@auto-guard/host-*` adapter + `@auto-guard/core` engine in the unified auto-guard monorepo. Fixes and features land there only. Upgrading = uninstall this package, install the unified one through the same host channel; your config root (`~/.dsh|~/.pi|~/.zcode/auto-guard/`) and all data are reused unchanged. Behavior differences: see `docs/differences.md` in the monorepo.

## Banner (Chinese)

> **⚠️ 已归档 —— 已合并进 [auto-guard](../auto-guard) 统一仓库。**
> 本项目成为统一 monorepo 中的 `@auto-guard/host-*` 适配层 + `@auto-guard/core` 引擎，后续修复与新特性只在统一仓库进行。升级方式：卸载本包，经同一宿主渠道安装统一包即可；配置根（`~/.dsh|~/.pi|~/.zcode/auto-guard/`）与全部数据原地续用。行为差异清单见统一仓库 `docs/differences.md`。
