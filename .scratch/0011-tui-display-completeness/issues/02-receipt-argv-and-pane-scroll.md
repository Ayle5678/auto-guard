# 02 — 回执记录用户视角 argv + 列表屏/帮助屏输出面板滚动键

**What to build:** (a) 回执只记录用户输入/动作语义的命令行——内部注入的 `--config-root` 只存在于实际执行调用，不再出现在 `❯` 回执行、footer、日志屏；(b) 列表屏与帮助屏新增 `PgUp`/`PgDn` 翻页、`g`/`G` 首/尾滚动输出面板（帮助屏滚全文），`↑↓/jk` 保持动作光标，日志屏键位不变；reduce 期按原始行数近似滚动，渲染期 clamp 兜底；footer 提示补滚动键（宽度不足优雅降级）；帮助页键位表同步新增滚动键（键位文档与行为 100% 一致的纪律）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 无头断言：回执 argv 不含 `--config-root`，而动作层实际调用参数仍注入当前根（单一事实源不破）
- [x] 无头断言：列表屏 `PgDn`/`g`/`G` 改变输出面板 offset 且 `↑↓` 仍移动动作光标；窄窗（如 80×24）下超视口回执 `g` 滚顶后首行可见、`G` 回底
- [x] 帮助屏同一套滚动键生效；键位表含 PgUp/PgDn（双语）
- [x] footer 出现滚动提示；100 列宽度下不换行不越界
- [x] `pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿
