# 02 — 用户规则热修：taskkill / localhost 探活 / 项目内脚本静态放行

**What to build:** 直接编辑本机 ZCode 宿主的用户规则文件（`~/.zcode/auto-guard/rules.json` 的 staticAllow 数组）追加：`taskkill //PID *`、`taskkill /PID *`、`curl * http://127.0.0.1:*`、`curl * http://localhost:*`、`node scripts/*`。生效后 agent 杀自己起的进程、本机端点探活、跑 workspace 的 scripts/ 下脚本不再进 LLM（30 天窗口预计直接消掉约 15% 的 llm-ask）。这是机器侧 ops 不是仓库代码：按 ADR-0013 这些数组项不会经 defaults 传播，其他机器需要时手工复制。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] 五条模式追加进用户 staticAllow（带一句话 reason，沿用现有条目风格）——已写入 `~/.zcode/auto-guard/rules.json`（130 条 staticAllow）
- [x] 用 decision-history 实录形态做 matchPattern 断言全命中：`taskkill //PID 40136 //F`、`curl -s -m 3 http://127.0.0.1:8600/health`、`node scripts/registry-offline.mjs 2>&1`（tests/user-rules-hotfix.spec.ts，含分类端到端）
- [x] 不误放行断言：`taskkill //IM explorer.exe //F`、`curl https://外网`、`node /绝对路径/外部脚本` 均不命中
- [x] 用户已知悉并接受权衡：rules.json 全局生效（跨 workspace 放行 `scripts/`）；`powershell -Command*` 在 alwaysReview 优先级更高，Stop-Process 包裹型仍靠提示词（已知残余）

## Comments

- 2026-10-05 用户批复：接受全局生效与跨 workspace 的 `scripts/` 放行。
