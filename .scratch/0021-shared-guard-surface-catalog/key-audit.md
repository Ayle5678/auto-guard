# SPEC 0021 票01 — 守卫面键三步审计

> 数据来源：`audit-dump.mjs`（本目录）对五个消息目录（core / host-runtime / host-pi / host-dsh / cli）的逐字节键值对比，原始输出见 `audit-dump.txt`。tui/i18n 与 installer/i18n 为包内 chrome（grill Round 16 Q9），不在审计范围。

审计按 ADR-0023 三步进行：

1. **同键逐字相同** → 直接搬 core 共享目录（本文件第二节）。
2. **同义异形** → 选语义最准者统一为正典（第三节；用户可见变化，键级 diff 清单随票02验收）。
3. **承载宿主上下文的措辞** → 留在宿主，或走 catalogOverride 数据槽保留宿主味（第四节）。

---

## 一、守卫面键总名单（按 ADR-0023 五类）

| 类别 | 键 | 现有定义处 |
|---|---|---|
| ping / 通用回执 | pingOk, pingFail, unknownError | runtime ≡ pi ≡ cli（逐字） |
| 删除流程 | deleteFailReviewerTitle, deleteFailLlmTitle | runtime / pi / dsh（三措辞） |
| 删除流程 | deleteFailDefaultReason, deleteRunAnyway | pi ≡ dsh（逐字） |
| 删除流程 | deleteAskReason, deleteNoDetail, deletionRetryHint | runtime 单源（opencode 对 deleteAskReason 有 descriptor override） |
| 密钥与审计 | showKeyEnvSet, showKeyEnvUnset, showKeyStored, showKeyNoStore, showKeyLegacy, showKeyNoLegacy | runtime ≈ cli / pi（风格异） |
| 密钥与审计 | clearKeyDone | runtime ≈ cli / pi（描述侧重异） |
| 密钥与审计 | setKeyNeedsTty, setKeyEnvWarning | runtime ≡ cli（setKeyNeedsTty）；setKeyEnvWarning runtime 单源 |
| 密钥与审计 | examineOn, examineOff, examineClearedOld, examineClearedAll | runtime ≡ cli / pi（On、ClearedOld 异） |
| 回执 | setLangInvalid, setLangDone, reloadNote | runtime ≡ cli（逐字） |
| usage | statsExamineOff | runtime / cli（程序名硬编码异） |
| usage | optimizeAutoUnsupported | runtime 单源（程序名硬编码） |
| 审计库管理 | exportUnsupported, exportDone, exportFailed, createNeedsPassword, createUnsupported, createDone, createFailed | dsh 单源 |
| 学习分析回执 | analyzeDone（完整形态）、rollbackDone、rollbackNoBackup | **已在 core**（engine 回执，`analyzeLearnedRules`/`rollbackLearnedRules` 返回） |
| 学习分析回执 | learnedAnalyzed、optimizeRollbackDone、optimizeRollbackNone、optimizeListEmpty | pi（与 core 回执重复定义/短形态） |
| 学习分析回执 | rollbackDone、rollbackNone | dsh（与 core 回执重复定义） |
| ask 逃生阀回执 | askListHeader, askListEmpty, askRow, askResolvedAllow, askResolvedDeny, askResolvedDenyWithReason, askInvalidIndex, askStaleIndex | runtime 单源（engine 渲染） |
| ping（dsh 变体） | pingNoDirectEndpoint | dsh 单源 |

## 二、第一步：逐字相同 → 直接搬

- `pingOk` / `pingFail` / `unknownError`：runtime ≡ pi ≡ cli（zh+en 逐字）。
- `deleteFailDefaultReason` / `deleteRunAnyway`：pi ≡ dsh（zh+en 逐字）。
- `examineOff` / `examineClearedAll`：runtime ≡ pi ≡ cli（zh+en 逐字）。
- `setKeyNeedsTty` / `setLangInvalid` / `setLangDone` / `reloadNote` / `statsAuditCount`：runtime ≡ cli（zh+en 逐字）。
- `contextAllow` / `contextDeny` / `contextAsk`（dsh）：**≡ core 既有 `kindAllow` / `kindDeny` / `kindAsk`（zh+en 逐字）**。处理：dsh 调用点改查 core 既有键，dsh 键删除——不进共享目录（共享目录不收 core 已有键的副本）。
- 单源键（runtime 的 ask 家族 8 键、删除流程 3 键、setKeyEnvWarning；dsh 的审计库管理 7 键、pingNoDirectEndpoint）：无漂移可能，原样搬入共享目录（「新守卫面键一处定义、全宿主生效」）。

## 三、第二步：同义异形 → 正典选择

| 键 | 迁移前措辞 | 正典 | 选择理由 |
|---|---|---|---|
| deleteFailReviewerTitle | runtime「审查器故障，本次删除未过审」/ pi「审查器故障，这次删除未过审」/ dsh「审查器故障，这次删除未过审」 | pi≡dsh 版（这次删除未过审） | 2/3 多数；本次=这次，无语义差 |
| deleteFailLlmTitle | runtime「LLM 未通过本次删除」/ pi「LLM 未通过这次删除」/ dsh「LLM 否决了这次删除」 | dsh 版（LLM 否决了这次删除） | 「否决」点明 LLM 是驳回主体，语义最准（grill R16 Q4 同判） |
| clearKeyDone | runtime/cli「已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）」/ pi「已清除加密存储的 API Key（明文遗留字段保持只读；环境变量不受影响）」 | runtime/cli 版 | 各宿主行为一致（core `clearApiKey` 只删加密文件），pi 的补充说明属信息增量而非行为差异；2/3 多数 |
| examineOn | runtime/cli「…（本地 SQLite + 字段级加密，数据不出本机）」/ pi「…（实验性，审计库已加密）」 | runtime/cli 版 | pi 与其他宿主用同一 core 审计库，「实验性」为过时定位；实现描述最准 |
| examineClearedOld | runtime/cli「已删除 {count} 条 30 天前记录」/ pi「已删除 {count} 条 30 天前的审查日志」 | runtime/cli 版 | 2/3 多数 |
| showKey 六键 | runtime/cli「env/stored/legacy: …」对齐列 / pi「环境变量/加密存储/明文遗留…」中文标签 | runtime 版（{dir} 占位） | ADR-0016「以最全宿主为基底」先例；占位统一为 {dir}（cli 调用点已同时传 {root}/{dir}，渲染零变化） |
| optimizeListEmpty | core「(无学习规则)」/ pi「（无学习规则）」 | core 既有键 | pi 为重复定义（仅全角/半角漂移）；pi 调用点改查 core 键。注：pi 该分支现为死代码（列表恒有表头），一并删除 |
| 回滚回执 | pi optimizeRollbackDone/None、dsh rollbackDone/rollbackNone vs core rollbackDone/rollbackNoBackup | core 既有回执 | core `rollbackLearnedRules` 已是单源实现并返回回执；pi/dsh 改渲染 `result.message`，「已从 backup」混排漂移消除 |
| 历史开关回执 | pi optimizeHistoryOn/Off（自渲染）vs core historyEnabledNote/historyDisabledNote（`applyHistoryToggle` 返回） | core 回执 | 同上：core 已是单源实现，pi 改渲染 `result.messages` |
| 学习分析回执 | pi learnedAnalyzed（短形态）vs core analyzeDone/analyzeDoneFull（`analyzeLearnedRules` 返回） | core 回执 | pi 改渲染 `result.message`，回执更完整（含分析窗口与写入文件） |
| statsExamineOff | runtime「…（cli.js examine on 后才有持久统计）」/ cli「…（auto-guard examine on 后才有持久统计）」 | 「{program} examine on …」参数化 | 程序名差异非措辞差异；SPEC 0020 程序名参数化注入（en 侧 runtime 由 cli.js 变 node dist/cli.js，更准确，进 diff 清单） |
| optimizeAutoUnsupported | runtime「用法：node dist/cli.js set 不支持 auto；…」 | 「用法：{program} set 不支持 auto；…」 | 同上；runtime 程序名注入后渲染逐字节不变 |

## 四、第三步：宿主上下文措辞

- **已有 descriptor override（ADR-0016，迁移后继续生效）**：`deleteAskReason`（opencode 权限框措辞）、`unreviewableBash`/`unreviewablePath`（opencode metadata/patterns、qoder 原始工具名）。三者中 deleteAskReason 进共享目录；unreviewable* 属 hook 管线措辞，留守运目录。createHostMessage 查词顺序 override → 守卫目录 → 宿主 chrome。
- **留宿主（绑定 dsh 私有分析流程，SPEC 0022 收编时再折）**：`analyzeNeedsExamine`（引用 dsh 设置字段名 examineEnabled）、`analyzeNeedsPassword`、`analyzeDone`（短形态，私有流程仅产 count）。
- **留宿主（宿主品牌串）**：dsh `contextFallbackReason`（「由 DSH Auto Guard 决定」）。
- **pi/dsh 迁移后今日无需 override**：第三节全部漂移均为同义词（非宿主行为差异），统一为正典；票03 建通道并配测试备用。
- **留守 runtime（hook 管线措辞，不在五类内）**：failBootstrap/failDecide/failStdinNotJson/failUncaught、hit* 十键、askDeniedNoPrompt/askEscapeHint/askModelContext、unknownDecisionDenied/passthroughDetail、wizard* 九键（TUI 向导 chrome）、unreviewableBash/unreviewablePath。
- **留守 pi（对话框/状态栏/slash 用法 chrome）**：ask/confirm/denyReason 对话框、status*/stats* 面板、guard*/examine*/optimize*/set* 的 CmdDesc/Usage、examinePassword*/examineStatus*/examineDb、setKey/setApi 对话框组、setKeyInlineWarning/setApiInlineWarning、optimizeStatus*/optimizeAutoOn/Off/switchOn/Off、setReloadDone、statusReviewerFailed（与 core 同名键语义不同：pi 为审阅器状态详情，非漂移）。

## 五、迁移后形状（票02 验收基准）

- 共享守卫面目录：约 45 键（ping 3 + 删除流程 7 + ask 回执 8 + 密钥与审计 16 + 审计库管理 7 + usage 2 + 学习分析 0——学习分析回执全部复用 core 既有键）。
- 宿主目录余量：runtime ~35 键（管线 + 向导）、pi ~50 键（对话框 + 面板 + slash）、dsh 4 键（私有分析流程 3 + 品牌串 1）、cli 4 键（聚合视图 + 根探测）。
- 判断逻辑、键名（除 dsh context* → core kind*、pi 死分支 optimizeListEmpty/learnedAnalyzed 删除外）、四层语言解析、defineCatalog 机制零变化。
