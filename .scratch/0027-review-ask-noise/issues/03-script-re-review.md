# 03 — 脚本附审：拒后附内容复审一次

**What to build:** 普通 LLM 审查路径（单命令/复合段/管线叶共用的裁决链）上，首审结论为 deny 或 ask、且命令呈"解释器+本地脚本"形态时，解析脚本路径并读取合限全文，经评审请求既有的 script 上下文槽附给评审员**再复核一次**，复审结论即终审、按所在路径走正常缓存写回。用户侧效果：`node scripts/x.mjs`、Temp 一次性脚本的"内容未知"类 ask/deny 自动升级为有内容的复审，不再打断用户；首审 allow 的命令行为完全不变。

- 触发边界（grill Round 2 Q10）：仅普通 LLM 审查路径；敏感路径降级、目录删除复核、写后执行（script 已在）、评审器故障（reviewerFailed）四类明确不触发。
- 识别：首 token 在解释器清单（defaults 数据字段，初始 node/python/python3/py/deno/bun/tsx）+ 下一个非 flag token 解析到存在的本地文件；绝对路径直接用，相对路径按 workspace 根或复合命令前导 `cd` 段解析，`$VAR` 展不开跳过；任何位置（含系统 Temp）。
- 限制：整文件 ≤100 行且 ≤16KB 且可解码文本（NUL/高不可打印占比判二进制跳过）三条件全满足才附；任一超限维持首审结论，不截断；复合命令只附第一个可解析脚本。
- 复审恰好一次；附审事实在决策详情留痕（decision-history 可辨"经脚本附审复审"）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] deny→附审→复审 allow；ask→附审→终审 deny（stub reviewer 调用计数恰为 2）
- [ ] allow 不触发第二次调用；reviewerFailed 不触发；敏感路径降级不触发；写后执行（script 已置）不重复触发
- [ ] >100 行 / 二进制 / `$VAR` 路径三种不附场景：首审结论维持、只调一次
- [ ] `cd <dir> && node 相对路径.mjs` 经前导 cd 段解析命中；解析不到文件跳过
- [ ] 解释器清单从 defaults 数据字段读取（顶层缺省补齐语义可到达存量安装）
- [ ] 附审留痕出现在 decision-history 详情

## Comments

- 与 01（提示词）无阻塞关系：01 压低首审 deny/ask 总量，03 兜住剩下确因内容未知的部分；先上 01 再上 03 观测更干净，但可并行施工。
