# 03 — 逃生舱自放行（窄口径）与文档、真实环境全链路验收

**What to build:** 守卫开启时逃生舱的只读与只降权路径直通不触发 ask（黑名单优先级不变）——出厂规则放行 `auto-guard guard ask list`（只读）与 `guard ask deny *`（只降权）；`allow`、`guard on/off`、`node <路径>` 直跑形态**不**放行：被守卫的代理不能给自己发许可或关闸，跨段 `*` 匹配不得成为代码执行洞（ADR-0019 决策 5 评审后收窄）。文档同步：usage 与 troubleshooting 新增「宿主三按钮是 zcode 约束 + 逃生舱用法 + 拒绝后直接对话说明需求」一节，双语 README 对应段落更新。最后在真实 zcode 会话跑一轮全链路：ask → 弹窗文案含提示 → `guard ask deny --reason` → 完全相同的命令不再弹窗、模型收到理由。

**Blocked by:** 02（被放行的命令面、被验证的链路都依赖 02 交付）

**Status:** done

- [x] 出厂规则放行 list/deny，永不放行 allow/off；hard-deny 语义不变（core ask-escape 自放行回归钉死）
- [x] usage / troubleshooting / README(zh+en) 逃生舱说明就位
- [ ] 真实 zcode 全链路验收（需维护者在装机上新开一次会话：ask → CLI 拒绝附理由 → 同命令不再弹窗、模型收到理由；结论回写本票）
- [x] 全仓 typecheck + test + smoke 全绿

## Comments

- 2026-08-31: 建票。
- 2026-08-31: 代码与文档就绪。自放行按评审收窄为「只读 + 只降权」（`allow`/`off`/node 直跑不放行），已同步 ADR-0019 决策 5、spec 与 usage 文案。存量安装需重跑 `auto-guard init` 让出厂规则升级步骤（ADR-0013）写入新放行。真实环境验收留待维护者执行后勾选。
