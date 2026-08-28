# 02 — `auto-guard init` 交互流

What to build:
- TTY 交互：检测结果复选框（已检测默认勾选、可手动追加并确认路径）→ 每宿主写入前展示 diff 摘要 → 备份（`*.auto-guard.bak`）→ 写入 → 校验 → 汇总（验证方法 / 卸载方法 / zcode 需新开会话提示）。
- 写入动作按 profile 模板渲染；只触碰 profile 声明的文件。

Blocked by: 01, SPEC 0001 #07, #08, #09
Status: ready-for-agent

Acceptance:
- [ ] 临时 HOME 集成测试：init 后 pi settings / zcode config 内容正确、备份存在
- [ ] 中断安全：任一宿主写入失败时其余宿主不受损，错误信息指明哪步失败
- [ ] 交互流在非 TTY 下拒绝并提示用 flags
