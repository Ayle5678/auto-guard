# 03 — 非交互 flags 与幂等

What to build:
- `init --host dsh,pi [--yes] [--config-root ...]`；`--yes` 跳过 diff 确认（备份仍强制执行）。
- 幂等：重复 init 检测已接入条目并跳过/修复，备份不被二次覆盖。
- 退出码：0 成功、2 有宿主失败或检测为空。

Blocked by: 02
Status: done

Acceptance:
- [x] 连续两次 `--yes` init 的文件内容与备份 mtime 稳定（幂等测试）
- [x] `--host` 含未知宿主名时报错并列出可用值
- [x] CI 友好：无 TTY 环境全 flags 运行通过
