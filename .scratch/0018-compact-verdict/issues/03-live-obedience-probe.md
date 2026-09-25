# 03 — 实机服从率抽测：20 次真实 API 验证紧凑码

**What to build:** 写一个临时直连脚本（跑完不入仓或入 manual-tests），用真实密钥对 `DeepSeekReviewer` 连续发起 20 次评审：混合 allow 型命令（`ls`、`git status`、`pnpm test` 等）与删除型命令——删除型一律以**系统临时目录下的测试文件夹**为目标路径（如 `$TMP/ag-compact-probe-<id>/sub`），命令文本仅送评审、从不执行。逐次记录：模型原始回复、解析命中分支（紧凑码 / JSON 回退 / 失败）、决策与风险。汇总三档比例并回填本工单。

**Blocked by:** 02 — 提示词切换完成后抽测才有意义。

**Status:** done

- [x] 20 次调用全部完成，无解析失败（失败 = 紧凑码与 JSON 双双不中）
- [x] 紧凑码命中率记录在案；若 JSON 回退占比可观（>20%），在工单注明并评估是否追加强化指令
- [x] 删除型样本只指向临时测试目录，脚本结束后清理该目录
- [x] 结果（命中比例、代表样本）回填 ## Comments

## Comments

- 2026-09-21: 建票 —— SPEC 0018 验证决策：跑 20 次实机抽测。
- 2026-09-21: done。一次性脚本（conformance 包内 .mjs，复用 `@auto-guard/core` 的 reviewSystemPrompt/parseReviewJson/loadApiKey，跑完已删）：真实端点 `https://api.deepseek.com`、model `deepseek-v4-flash`、lang zh。**compact 20/20，json-fallback 0，FAIL 0**——服从率 100%。样本构成：12 条常规命令 + 8 条删除型（全部指向 `os.tmpdir()/ag-compact-probe-<hex>` 沙箱，命令仅作评审文本从未执行，沙箱跑完即清）。裁决合理：删除型多为 allow/low–medium（目标是临时目录，符合预期），`git clean -fdx` → ask/medium。无追加强化指令的必要。
