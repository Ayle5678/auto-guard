# 05 — 安装器文档

What to build:
- 安装器章节并入根 README（中英）：三分钟上手（init → 勾选 → 新会话验证）、flags 表、与各宿主原生安装渠道的关系（并存、何时选哪个）、卸载。
- 新宿主接入指南：如何写一条新 profile + 适配层包（面向未来贡献者，引用 ADR-0008）。
- 故障排查：检测不到宿主、hooks 未生效（zcode 需新会话）、权限被宿主配置默认禁用等。

Blocked by: 03, 04
Status: done

Acceptance:
- [x] README 安装器章节与实际 flags/行为一致（对照测试清单人工核对）
- [x] 新宿主指南含一个最小 profile 示例
- [x] 故障排查覆盖 SPEC 中列出的三种已知坑
