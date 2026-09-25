# SPEC 0021 票03 — chrome 边界清单（守卫面归 core、chrome 归各包）

> 检验纪律：`packages/conformance/tests/catalog-boundary.spec.ts` 硬校验「四宿主目录不得定义共享守卫面键」；正典键集由 `packages/core/tests/guard-messages.spec.ts` 快照钉定。措辞差异的唯一合法通道是数据槽（hook 宿主 `HostDescriptor.catalogOverride`、pi/dsh `create*Message(overrides)`），键副本即漂移。

## 一、边界定义

- **进 core 共享守卫面目录**（`core/src/guard-messages.ts`，45 键）：五类用户可见守卫面文案——回执（ask 逃生阀、操作确认）、usage、删除流程、密钥与审计（ping / show-key / set-key / clear-key / examine 开关与清理 / dsh 审计库导出重建）、学习分析回执（复用 core 命令层既有键）。
- **留各包（chrome）**：对话框与弹窗文案、设置页/状态栏/统计面板、安装器、TUI、hook 管线措辞（fail 阶梯、unreviewable、ask 逃生提示）、宿主品牌串。

## 二、四宿主目录现状（迁移后）

| 目录 | 迁移前键数 | 删除 | 现存 chrome 键 | 现存内容 |
|---|---|---|---|---|
| host-runtime | 65 | 35 | 30 | fail* 阶梯 4、unreviewable* 2、hit* 10、ask 管线提示 3（askDeniedNoPrompt/askEscapeHint/askModelContext）、unknownDecisionDenied/passthroughDetail 2、wizard* 9、TUI 其余 chrome（deleteAskReason 已迁 core） |
| host-pi | 85 | 24 | 61 | 对话框组（ask/confirm/denyReason/set-key/set-api/examine 密码）、状态栏 status* 14、统计面板 stats* 7、slash CmdDesc/Usage 8、examine 状态行 4、optimize 状态/开关回执 9、内联警告 2、switchOn/Off 等 |
| host-dsh | 21 | 17 | 4 | analyzeNeedsExamine / analyzeNeedsPassword / analyzeDone（绑定 dsh 私有分析流程，SPEC 0022 收编时折入 core 回执）、contextFallbackReason（宿主品牌串） |
| cli | 24 | 20 | 4 | noRootFound + aggregate* 3（多宿主聚合视图 chrome） |

core 侧：`core/src/messages.ts`（引擎自身文案，52 键）不动；`core/src/guard-messages.ts` 新增 45 键 + `GuardMessageOverrides` 数据槽类型。

## 三、宿主味键落位（票03 验收项）

| 审计判定的宿主味措辞 | 落位 |
|---|---|
| `deleteAskReason`（opencode 权限框措辞）、`unreviewableBash/Path`（opencode/qoder） | 既有 `HostDescriptor.catalogOverride` 数据槽，迁移后查词顺序 override → 守卫目录 → chrome，渲染不变（既有宿主契约测试钉定） |
| dsh `analyzeNeedsExamine`（引用 dsh 设置字段名） | 留 dsh 目录（绑定私有分析流程，SPEC 0022 折叠时可改走 core 回执 + override 槽） |
| dsh `contextFallbackReason`（「由 DSH Auto Guard 决定」品牌串） | 留 dsh 目录 |
| pi/dsh 其余守卫面漂移 | 均为同义词而非宿主行为差异，票02 统一为正典；**今日无键需要 override**——通道由 `host-pi/tests/messages-override.spec.ts` 与 `host-dsh/tests/messages-override.spec.ts` 备用验证 |

## 四、机制不变（ADR-0011）

`defineCatalog` 类型对齐、每包目录纪律、四层语言解析（env > config.lang > 机器默认 > zh）零改动；动的只是键的家。`[删除理由]` 协议标记不双语。
