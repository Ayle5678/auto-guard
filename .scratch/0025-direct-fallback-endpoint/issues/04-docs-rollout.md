# 04 — 文档与本机迁移

**What to build:** ADR-0026（直连通道备用端点契约）；本机 zcode 根迁移——`api-key.json` 复制为 `api-key-fallback.json`（现存 MIMO key 平移为备用槽），config.json 主端点切回 DeepSeek（apiBase/model）并写 fallbackApiBase/fallbackModel；重构建 + 按既有 tar 包流程更新已装插件；用户 TTY 跑 `set set-key` 录入 DeepSeek 主 key。

**Blocked by:** 01、02、03。

**Status:** resolved

- [x] ADR-0026 落档
- [x] 全仓 12 包测试绿（1078 用例）
- [x] pnpm build 通过
- [x] 本机迁移：备用槽就位、config 切换完成；主 key 待用户 TTY 录入（密钥只有用户持有）

## Comments

- 2026-09-28 迁移验证路径：`guard ping` 打主端点；实跑需 LLM 审查的命令观察 decision-history 不再新增 timeout 拒绝；如需验证备用腿，可临时把 apiBase 指向无效地址观察接管后改回。
