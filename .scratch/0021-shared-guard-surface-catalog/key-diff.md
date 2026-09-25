# SPEC 0021 票02 — 键级 diff 清单（用户可见文案逐条可审）

> 迁移前 = 各宿主目录原值；迁移后 = core 共享目录正典。`＝` 表示该宿主渲染结果不变；`≠` 表示变化（正典统一）。`{program}` 行按驱动程序名注入后与原文逐字节相同的标注为`＝(参数化)`。

## pingOk
- runtime ＝
- pi ＝
- cli ＝
## pingFail
- runtime ＝
- pi ＝
- cli ＝
## unknownError
- runtime ＝
- pi ＝
- cli ＝
## pingNoDirectEndpoint
- dsh ＝
## deleteFailReviewerTitle
- runtime ≠
  - zh: "审查器故障，本次未过审" → "审查器故障，这次删除未过审"
  - en: "Reviewer failure — this deletion was not approved" → "Reviewer failure — this deletion was not approved"
- pi ＝
- dsh ＝
## deleteFailLlmTitle
- runtime ≠
  - zh: "LLM 未通过本次删除" → "LLM 否决了这次删除"
  - en: "The LLM rejected this deletion" → "The LLM vetoed this deletion"
- pi ≠
  - zh: "LLM 未通过这次删除" → "LLM 否决了这次删除"
  - en: "The LLM rejected this deletion" → "The LLM vetoed this deletion"
- dsh ＝
## deleteFailDefaultReason
- pi ＝
- dsh ＝
## deleteRunAnyway
- pi ＝
- dsh ＝
## deleteAskReason
- runtime ＝
## deleteNoDetail
- runtime ＝
## deletionRetryHint
- runtime ＝
## askListHeader
- runtime ＝
## askListEmpty
- runtime ＝
## askRow
- runtime ＝
## askResolvedAllow
- runtime ＝
## askResolvedDeny
- runtime ＝
## askResolvedDenyWithReason
- runtime ＝
## askInvalidIndex
- runtime ＝
## askStaleIndex
- runtime ＝
## setKeyNeedsTty
- runtime ＝
- cli ＝
## setKeyEnvWarning
- runtime ＝
## showKeyEnvSet
- runtime ＝
- pi ≠
  - zh: "环境变量 {name}：已配置（优先生效）" → "env {name}: 已设置（优先于本地存储）"
  - en: "Environment variable {name}: set (takes priority)" → "env {name}: set (takes priority over local storage)"
- cli ＝
## showKeyEnvUnset
- runtime ＝
- pi ≠
  - zh: "环境变量 {name}：未配置" → "env {name}: 未设置"
  - en: "Environment variable {name}: not set" → "env {name}: not set"
- cli ＝
## showKeyStored
- runtime ＝
- pi ≠
  - zh: "加密存储：已存储（AES-GCM 加密于 {dir}/api-key.json）" → "stored     : 已存储（AES-GCM 加密于 {dir}/api-key.json）"
  - en: "Encrypted storage: stored (AES-GCM at {dir}/api-key.json)" → "stored     : stored (AES-GCM encrypted at {dir}/api-key.json)"
- cli ≠
  - zh: "stored     : 已存储（AES-GCM 加密于 {root}/api-key.json）" → "stored     : 已存储（AES-GCM 加密于 {dir}/api-key.json）"
  - en: "stored     : stored (AES-GCM encrypted at {root}/api-key.json)" → "stored     : stored (AES-GCM encrypted at {dir}/api-key.json)"
## showKeyNoStore
- runtime ＝
- pi ≠
  - zh: "加密存储：(未存储)" → "stored     : (未存储)"
  - en: "Encrypted storage: (not stored)" → "stored     : (not stored)"
- cli ＝
## showKeyLegacy
- runtime ＝
- pi ≠
  - zh: "明文遗留：{key}（只读保留，建议 set-key 重存加密版）" → "legacy     : {key}（config.json 明文遗留，建议 set-key 重存）"
  - en: "Legacy plaintext: {key} (kept read-only; re-store via set-key)" → "legacy     : {key} (plaintext legacy in config.json; re-store via set-key)"
- cli ＝
## showKeyNoLegacy
- runtime ＝
- pi ≠
  - zh: "明文遗留：(无)" → "legacy     : (无)"
  - en: "Legacy plaintext: (none)" → "legacy     : (none)"
- cli ＝
## clearKeyDone
- runtime ＝
- pi ≠
  - zh: "已清除加密存储的 API Key（明文遗留字段保持只读；环境变量不受影响）" → "已清除本地存储的 API Key（加密文件已删除；环境变量不受影响）"
  - en: "Encrypted API key cleared (the legacy plaintext field stays read-only; environment variables unaffected)" → "Locally stored API key cleared (encrypted file deleted; environment variables unaffected)"
- cli ＝
## setLangInvalid
- runtime ＝
- cli ＝
## setLangDone
- runtime ＝
- cli ＝
## reloadNote
- runtime ＝
- cli ＝
## examineOn
- runtime ＝
- pi ≠
  - zh: "审查日志已开启（实验性，审计库已加密）" → "审查日志已开启（本地 SQLite + 字段级加密，数据不出本机）"
  - en: "Audit log enabled (experimental; the database is encrypted)" → "Audit log enabled (local SQLite + field-level encryption; data never leaves this machine)"
- cli ＝
## examineOff
- runtime ＝
- pi ＝
- cli ＝
## examineClearedOld
- runtime ＝
- pi ≠
  - zh: "已删除 {count} 条 30 天前的审查日志" → "已删除 {count} 条 30 天前记录"
  - en: "Deleted {count} audit record(s) older than 30 days" → "Deleted {count} record(s) older than 30 days"
- cli ＝
## examineClearedAll
- runtime ＝
- pi ＝
- cli ＝
## statsAuditCount
- runtime ＝
- cli ＝
## statsExamineOff
- runtime ≠ ＝(参数化)
  - zh: "审查日志未开启（cli.js examine on 后才有持久统计）" → "审查日志未开启（{program} examine on 后才有持久统计）"
  - en: "Audit log is off (run cli.js examine on for persistent stats)" → "Audit log is off (run {program} examine on for persistent stats)"
- cli ≠ ＝(参数化)
  - zh: "审查日志未开启（auto-guard examine on 后才有持久统计）" → "审查日志未开启（{program} examine on 后才有持久统计）"
  - en: "Audit log is off (run auto-guard examine on for persistent stats)" → "Audit log is off (run {program} examine on for persistent stats)"
## optimizeAutoUnsupported
- runtime ≠ ＝(参数化)
  - zh: "用法：node dist/cli.js set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled" → "用法：{program} set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled"
  - en: "Usage: node dist/cli.js does not support set auto; edit autoAnalyzeEnabled in config.json manually" → "Usage: {program} does not support set auto; edit autoAnalyzeEnabled in config.json manually"
## exportUnsupported
- dsh ＝
## exportDone
- dsh ＝
## exportFailed
- dsh ＝
## createNeedsPassword
- dsh ＝
## createUnsupported
- dsh ＝
## createDone
- dsh ＝
## createFailed
- dsh ＝
## 复用 core 回执（宿主键删除，不再有独立文案）
- pi learnedAnalyzed → `analyzeLearnedRules` 返回的 core 回执（analyzeDone / analyzeDoneFull）
- pi optimizeRollbackDone / optimizeRollbackNone → `rollbackLearnedRules` 返回的 core 回执（rollbackDone / rollbackNoBackup）
- pi optimizeHistoryOn / optimizeHistoryOff → `applyHistoryToggle` 返回的 core 回执（historyEnabledNote / historyDisabledNote）
- pi optimizeListEmpty → core 同名键（该分支现为死代码：列表恒带表头，随迁移删除）
- dsh rollbackDone / rollbackNone → `rollbackLearnedRules` 返回的 core 回执（rollbackDone / rollbackNoBackup）
- dsh contextAllow / contextDeny / contextAsk → core 同义键 kindAllow / kindDeny / kindAsk（逐字相同，渲染零变化）

### 复用项的措辞明细（迁移前 → 迁移后，逐条可审）

- pi optimizeRollbackDone：「已从 backup 恢复学习规则」→ core rollbackDone「已从备份恢复学习规则」；en 不变（Learned rules restored from backup）
- pi optimizeRollbackNone / dsh rollbackNone：「没有可恢复的 backup」→ core rollbackNoBackup「没有可用的备份文件」；en「No backup to restore」→「No backup file available」
- dsh rollbackDone：「已从 backup 恢复学习规则」→ core rollbackDone「已从备份恢复学习规则」；en 不变
- pi optimizeHistoryOn/Off：「运行时历史层已开启/已关闭」→ core historyEnabledNote/historyDisabledNote「history 层已开启/已关闭（按命令骨架复用 60 天审计放行记录）」；注意：examine 未开启时 core 回执追加第二行 historyNeedsExamine 提示（pi 原先无此行）
- pi learnedAnalyzed：「学习规则分析完成：cacheable {count}」→ core analyzeLearnedRules 回执（analyzeDone/analyzeDoneFull 完整形态：含分析窗口条数与写入 learned-rules.json 说明）
- pi optimizeListEmpty：「（无学习规则）」全角括号 → core「(无学习规则)」（该分支为死代码，渲染不变）

### 精度注记

- showKeyStored：cli 目录原文用 {root} 占位、正典用 {dir}；引擎调用点两占位符均传同一根目录，渲染逐字节不变——表内 ≠ 为模板级差异，非用户可见变化
- statsExamineOff / optimizeAutoUnsupported：{program} 注入后 zh 侧逐字节不变；runtime 驱动 en 侧由字面 cli.js 变为实际程序名 node dist/cli.js（更准确）
- exportDone：迁移后 {path} 参数化，dsh 调用点传入 ~/.dsh/auto-guard/audit.export.db，渲染不变
