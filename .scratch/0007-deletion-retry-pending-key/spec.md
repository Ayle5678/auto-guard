# 0007 — 删除复核重试契约脆弱：pending 键对不上，重试无限循环

## 问题

Headless 目录删除复核流（ADR-0012）的「首拦 → 带 `[删除理由]` 重试 → LLM 复核」契约在真实使用中极脆弱：
pending 表按**整条命令文本**（小写化后）做键（`guard-service.ts` `decideDirectoryDelete` → `buildSessionKey(session, workspace, command.toLowerCase())`）。重试命令经过 `prepareDeletionMarker` 清洗（剥掉 `[删除理由] <reason>`）后，只要与被拦原文有任何文本差异，就 miss → 被当成**新的首次删除** → 再次 deny + 新增一条 pending 记录。

### 实证（2026-08-29，本次崩溃修复的收尾清理时触发）

同一个逻辑删除（`rm -rf .tmp-ag-test`）三次重试全部 miss，`~/.zcode/auto-guard/sessions/pending-deletes.json` 堆了三条互不相同的 pending：

1. 首拦发生在复合命令里：`cd … && rm -rf .tmp-ag-test && grep … && git status …` —— 键是**整串复合命令**。
2. 独立重试 `rm -rf .tmp-ag-test # [删除理由] …` —— 清洗后命令带尾部 ` #`，键不匹配。
3. 独立重试 `rm -rf .tmp-ag-test [删除理由] …` —— 清洗后为裸命令，与 1 的复合命令键不匹配、与 2 也不匹配。

用户视角表现为无限「⛔ 拦截 [删除复核]: Directory deletion requires a reason」，明明每次都附了理由。

### 附带缺陷

- 每次 miss **新增**一条 pending（`decideDirectoryDeletes.set(key, {deniedAt})`），无界堆积；miss 后旧条目没有清理路径。
- deny 文案只说「retry the same command」，不回显被记录的命令原文，agent/用户无法知道要对齐到哪段文本。
- 实测中 workspace 解析在复合命令与独立命令间也不一致（一次是 `.tmp-ag-test`，一次是 `auto-guard`），键的第三个不稳定来源，需查证 `workspaceFromEnv` 的解析时机。

## 边界（不要动的）

- LLM 传输层 `httpPostText`（grill-log Round 7 已定稿）；ADR-0012 的语义本身（rm + 递归 flag ⇒ directory-delete）不变。
- 不要为对齐键而放宽成「忽略整条命令只看目录路径」——那会让不同命令误命中同一条复核。

## 研究方向（按性价比排序）

1. **文案回显（止血，最小改动）**：deny 文案附上 pending 里记录的命令原文（截断），让 agent 能逐字重试。先止血再治本。
2. **miss 降级为近邻匹配**：pending miss 时不立即记新条目，先在 pending 表里找「同 session + 同 workspace 根 + 命令包含同一删除目标路径、`deniedAt` 最近且未过期」的条目复用；命中则走既有复核流。需要防误命中：删除目标路径从命令 token 里引号感知地提取，全等才算。
3. **键归一化**：键从全文文本改为稳定形状（如引号感知拆分后取删除目标路径的规范化形态）。研究 `command.ts` 的拆分器能否直接复用；注意Windows/POSIX 路径分隔符与大小写。
4. **清洗侧对齐**：`prepareDeletionMarker` 清洗时连带剥掉 marker 前残留的注释符（`#`、`%%` 等）与多余空白；补单测钉死「清洗后命令 == 原命令」不变式。
5. **记录卫生**：miss 复用近邻条目后不再新增；给 pending-deletes.json 加 TTL 剪枝（查 `persist-map.ts`/`session-store.ts` 是否已有可复用的剪枝机制）。

## Acceptance

- [ ] 上述三个真实 case 各自重试都能命中同一条 pending，LLM 复核恰好发生一次，pending 恰好消费一条
- [ ] pending-deletes.json 有界（miss 不再堆积；有 TTL 或复用）
- [ ] deny 文案回显 pending 命令原文
- [ ] guard-service spec 新增回归：复合命令首拦 → 独立命令带 marker 重试 → 命中
- [ ] 既有删除流测试全绿；Qoder 实测一轮 headless 删除复核
