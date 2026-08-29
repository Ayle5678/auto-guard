# 0007 — Issue 01：pending 键对齐与重试自愈

What to build:
- 按spec「研究方向」落地：先 1（文案回显止血），再 2（miss 近邻匹配自愈）+ 4（清洗对齐），3/5 视 2 的效果决定是否还需要。
- 全部改动收敛在 core（`guard-service.ts` / `commands.ts` / `persist-map.ts`），宿主层不动。

Blocked by: 无
Status: done

Acceptance:
- [ ] 三个实证 case（复合命令首拦 / `#` 注释尾重试 / 独立命令+marker 重试）各自命中同一条 pending，复核恰好一次
- [ ] miss 不新增 pending 条目；pending-deletes.json 有界
- [ ] deny 文案回显 pending 命令原文（截断到单行）
- [ ] guard-service spec 回归钉死上述场景；`pnpm -r test` 全绿
- [ ] Qoder 实测一轮 headless 删除复核（真实环境验证键对齐）

## Comments

- 2026-08-29: 建票 —— 证据来自本次 libuv 崩溃修复收尾时的真实卡死；三条 pending 键原文见 spec.md
- 2026-08-29: done。落地方向 1+2+4+5（3 不需要：近邻匹配已覆盖键归一化要解决的问题，且不牺牲安全性）。全部改动收敛在 core：`guard-service.ts`（pending 条目记录原文、miss 时同 session + 同工作区子树 + 删除目标全等的近邻复用、24h TTL 触碰剪枝、deny 文案经 coreMessage 回显记录命令）、`messages.ts`（deleteNeedsReason / deleteRetryNoReason 双语）、`persist-map.ts`（PersistableMap.entries）。清洗侧 `extractDeletionMarker` 连带剥掉 marker 前残留的 `#`/`%%` 独立尾 token（`rem` 不剥：单独 `rem` 可能是真实目录名，清洗结果是要执行的命令）。guard-service.spec 新增 it.each 三形态回归（复合首拦 / `#` 残留重试 / 复合原文带 marker 重试）+ 近邻误命中防护 + 工作区子树漂移 + legacy 条目 + TTL 剪枝 + clearSession 共 12 例。真实 stale 键处理：TTL 24h 触碰剪枝自然清掉旧格式条目（仅 deniedAt 的条目经键反解仍可近邻匹配），无需手删；本机 `.zcode` 会话目录里的两条实测 stale 键在下次触碰该 session 时自动消亡。校验：`pnpm -r typecheck`、`pnpm -r test`（七包全绿，conformance 73）、`pnpm smoke` 全过。ZCode 宿主实测：复合命令首拦（deny 文案回显复合原文）→ 独立 `rm -rf .tmp-ag-0007 # [删除理由] …` 重试命中同一条 pending，LLM 恰好复核一次（decision-history：source=directory-delete, risk=low），pending 恰好消费一条（文件归零）。
