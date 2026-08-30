# 0013 — 宿主运行时：hook 形态宿主收敛

## Spec

四个 hook 宿主（zcode/claude/qoder/opencode）适配层的逐字拷贝收敛为 `@auto-guard/host-runtime`（ADR-0016；完整拍板推理见 grill-log Round 11）：`createHookHost(宿主描述符)` 唯一入口，宿主包退化为「描述符 + dist 入口重导出」的薄门面，安装器 profile 与已装用户零感知。

范围与拍板（用户 2026-08-30）：

- **描述符**：八字段纯数据（hostId、configDir、守卫工具名表含 qoder delete_file→bash/rm 合成、路径/内容字段拼写防御链、envNames、宿主能力值）+ 出口序列化器槽 + 可选目录扩展。**不加第七个槽**——描述符若开始长行为函数即是 seam 放错的信号（ADR-0016）。
- **opencode 加入**：`{status,reason}` 契约 + `parseVerdict`/`statusToReply` 落序列化器槽；plugin.ts 总线接线、`SeenRequests` 防重放、`payloadFromAsked`/`payloadFromSdkPermission` 留宿主侧（真宿主耦合）。
- **语言层以 zcode 版为基底**：claude/qoder/opencode 硬编码中文串换运行时目录取词，四层解析 + `set lang` + 交互向导随之补齐；中文兜底保证默认输出逐字节不变，已 `set lang` 的宿主拿到本应生效的英文（修 bug 不是破坏）。
- **pi/dsh 仅复用 `buildGuardDeps`**（host-runtime 单独导出，pi 的 buildGuard、dsh 的 createState 改调它；会话态/审计实现仍各选各的）；事件接线与 UI 不动。
- **qoder delete_file（SPEC 0012）先行独立合并**，本 spec 的移植票把它当既有行为携带。

迁移纪律：每票切换前后 conformance 全量绿；qoder≡claude 序列化器逐字节 pin 保留为迁移检查点、04 票才删；门面 dist 文件名（`hook-cli.js`、`session-start.js`、`cli.js`、`plugin/`）不变，installer `resolvePackagePaths` 与 smoke 脚本零改动。

依赖方向：`host-runtime → core`（零宿主 SDK）；`host-{zcode,claude,qoder,opencode} → host-runtime`；`host-{pi,dsh} → host-runtime`（仅 buildGuardDeps）。

Design: ADR-0016。

## Issues

- 01-extract-runtime-zcode.md — 抽运行时并切 zcode（createHookHost + 描述符 + 参数化契约测试框架 + buildGuardDeps 导出）
- 02-port-claude-qoder.md — claude/qoder 切换（语言层补齐，默认输出逐字节不变断言）
- 03-port-opencode.md — opencode 切换（序列化器槽；plugin.ts 留守宿主侧）
- 04-conformance-language-regression.md — conformance 改造（经 createHookHost 参数化、删逐字节 pin、加「差异只在声明数据」契约测试）+ 语言回归矩阵
- 05-pi-dsh-buildguarddeps.md —（可选）pi/dsh 复用 buildGuardDeps，消灭剩余两份接线

Status: done
