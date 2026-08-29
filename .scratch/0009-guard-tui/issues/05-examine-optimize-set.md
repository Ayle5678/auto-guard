# 0009 — Issue 05：审计 + 优化 + 密钥屏（含三步 set-key 向导）

What to build:
- 审计屏（屏 3）：on/off 开关（`examine on|off`）；status 面板（`examineStatusLines`）；`clear-old`（30d）；`clear-all` 过红色确认框。
- 优化屏（屏 4）：status 面板（`optimizeStatusLines`，含上次分析时间）；`analyze`（busy；examine 关时显示 core 原提示）；`list` 学习规则滚动区（`optimizeListLines`）；`rollback` 过确认框（提示备份语义）。
- 密钥屏（屏 5）：
  - `show-key` 面板（env 设置与否 / 加密存储与否 / 遗留明文脱码——`hasStoredApiKey` + `maskKey`）；
  - **set-key 三步向导**：base URL（Enter 保留现值）→ model（Enter 保留现值）→ API key（掩码输入）；校验对齐 host-zcode 旧向导（base 须 `http(s)://`、key trim 后 ≥8 字符且无空白）；通过后 `saveApiKey(root, key)` + config 的 base/model 变更走 `set-api`（`applySetApi`）保存；完成后建议 ping；env 已设置时先警告（沿用语义）；
  - `clear-key`（确认框）；
  - `set-api base <url>` / `model <id>` / `reset` 内联输入；
  - `lang zh|en` 即切即生效（经 `set lang`，回执新语言，TUI 铬件下一帧跟随）；
  - `history on|off` 开关；`reload` 说明行。
- 向导全程掩码；key 永不进入日志屏与 footer。

Blocked by: 03
Status: done

Acceptance:
- [x] 向导三条非法路径（坏 base / 短 key / 含空白 key）与取消路径（Esc）都拒绝且不落盘
- [x] 成功路径后 `show-key` 面板立即可见存储状态，config 的 apiBase/model 同步更新
- [x] 确认框覆盖 clear-all / clear-key / rollback；Esc 全部可取消
- [x] `lang` 切换后整屏语言即时一致（含 footer 回执语言）
- [x] 单测：向导状态机 + 校验 + 保存调用（注入假 saveApiKey/applySetApi）

## Comments

- 2026-08-30: 完成。三屏动作 + 确认框（clear-all/clear-key/rollback）；三步向导（Enter 保留现值、掩码、非法 base/key 拒绝、Esc 取消、review 显示 maskKey 脱码）；saveWizard 落盘 e2e 单测（加密 key + 端点变更持久化）；set lang 即切即生效（run-done → refresh → roots 事件重解析语言）。
