# 03 — 三个宿主适配层会话内文案双语

**What to build:** 英文用户在宿主侧看到的一切 auto-guard 文案为英文，中文用户零变化。按包全量迁移、非穷举：host-pi 的扩展 UI（确认对话框、拒绝原因输入、/guard 命令注册与统计输出、状态条）；host-zcode 的 **自带管理 CLI（guard|set|examine|optimize 全部用法行与输出，含审计统计、set-key 警告、autoAnalyze 保护提示等）**、hook 拦截提示与 fail-closed 消息、hook 输出渲染；host-dsh 的通知策略与全部消息。语言在各进程启动时解析一次（hook 本就每次启动重读配置），文案归各包自己的消息目录，core 只出取词函数。

**Blocked by:** 01、02

**Status:** ready-for-agent

- [ ] host-zcode 自带管理 CLI 全部输出随语言切换（en 金路径断言）
- [ ] 每包至少一条 en 金路径断言（注入语言后捕获输出文案）
- [ ] zh 兜底：存量测试零改动通过
- [ ] 单次进程运行内语言只解析一次
