# 06 — 文档：手册/README/警示与修复指引

What to build:
- README / README.zh-CN / docs/usage / docs/cli 增两宿主：安装矩阵、配置根（`~/.claude/auto-guard/`、`~/.config/opencode/auto-guard/`）、ask 体验说明（claude 原生确认框；opencode TUI 三态一次/本会话总是/拒绝）。
- 警示段：cc-switch / clawd 会整体覆写 `~/.claude/settings.json` 抹掉 hooks（症状、`guard ping` 自检、重新 `auto-guard init` 恢复）。
- opencode 启动器修复指引（npm postinstall 未执行的一行修复）。
- opencode 覆盖面说明：用户 permission 规则放行的调用不进守卫（ADR-0011 后果）。
- hermes / qoder 暂缓说明，指向 `.scratch/0004-host-claude-opencode/research/`。

Blocked by: 02, 04, 05
Status: done

Acceptance:
- [x] 中英手册均含两宿主章节与两个警示段
