# 02 — 三命令与交互流程双语接入、测试与文档

What to build:
- `install.ts`：语言解析（flag → env → 交互 init 双语提问 → zh），头图永远第一屏（语言未知时 tagline 双语）；init/list/remove 全部输出走目录。
- `interactive.ts`：`promptLanguage`（数字 + 语言名可输、错误重问带双语提示）与宿主选择文案本地化。
- `detect.ts` / `plan.ts` / `remove.ts` / `banner.ts`：options 增加 `lang`（缺省 `zh`），证据行、计划描述 / blocked、卸载结果、tagline 跟随语言。
- 测试：交互语言提问流（英文全流程）、`--lang en` / `AUTO_GUARD_LANG` / 兜底 zh、`list`/`remove`/blocked 英文输出、prompt 解析矩阵；既有交互测试注入序列前置语言答案。
- 文档：`docs/cli.md`（flags + 语言解析顺序）、`docs/usage.md`（流程示例、非交互、flags 表）。

Blocked by: 01
Status: done

Acceptance:
- [x] 交互选 `2` 后整流程英文（选择提示、确认、汇总），无中文残留；头图先于语言提问出现且 tagline 双语
- [x] 非交互无 `--lang` 时输出与改造前一致（存量测试零文案改动通过）
- [x] `list --lang=en` / `remove --lang en` 输出英文；无效 `--lang` 双语报错
- [x] 全仓 `pnpm -r test`（480+）与 `pnpm -r typecheck` 通过；真实 CLI 冒烟（en / zh / 非法值）通过
