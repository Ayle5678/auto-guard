# 0027 — 审查降噪：ask 提示词校准 + 脚本附审 + 用户规则热修

> Status: resolved
> 决策依据：ADR-0020（裁决码契约；系统提示词是其上层指令文本）、ADR-0024（两评审通道共享同一 prompt，直连/宿主流式同受影响）、ADR-0013（规则双层文件：数组项不自动到达存量用户侧，热修须直接改用户 rules.json）、grill-log 2026-10-05 两轮。

## Problem Statement

主审查端点切到 MIMO（flash 档，SPEC 0025/0026）后，LLM 判 ask 的频率逐月爬升：8 月 1.0% → 9 月 1.7% → 10 月 2.5%（decision-history，30 天窗口 203 次 llm-ask）。归因三类：① 系统提示词自 DeepSeek 时代就有 "prefer ask over allow when unsure about destructive effects" 的宽泛兜底，flash 档模型更依赖它，把跑项目脚本、杀进程、临时文件清理、localhost 探活这类典型 agent 开发循环操作也推去 ask；② 评审员只看得到命令字符串，`node/python <脚本>` 形态一律"内容未知"ask（30 天 18 次，Temp 脚本两分钟内双 ask 实录）；③ taskkill/Stop-Process 类进程管理高频命令没有静态放行（30 天 30 次，占 llm-ask 的 15%）。每次 ask 都打断用户，上述三类合计约占总量的三分之二，是可消除噪声。

## Solution

三管齐下：① 把系统提示词的 ask 规则从"不确定就问"校准为"ask 是昂贵中断，仅 allow 与 deny 都不成立时使用"，明确典型开发循环操作的 allow 倾向与复合命令的整体语义判断；② 新增脚本附审——普通 LLM 审查路径上，命令呈"解释器+本地脚本"形态且首审 deny/ask 时，读取合限脚本文本附给评审员再复核一次，复审即终审；③ 直接在本机用户 rules.json 补静态放行模式（taskkill PID、localhost 探活、可信项目脚本），零代码当天生效。

## User Stories

1. 作为用户，agent 执行自己刚写的项目脚本被首审以"内容未知"拦下时，守卫自动把脚本文本附给评审员复审，所以我不必为每个脚本执行手动确认。
2. 作为用户，agent 杀自己起的服务进程（taskkill 指定 PID）直接放行，所以端口清理循环不再打断我。
3. 作为用户，MIMO 对多行 for 循环误判"loop body missing"的 ask 减少，因为提示词要求按整体语义判断复合/循环命令。
4. 作为用户，agent 在 Temp 目录跑一次性脚本（accept-*.mjs 类）被拒后附内容复审，同一命令不再两分钟内问两次同类问题。
5. 作为用户，agent curl 本机端点做健康探活直接放行，本地联调循环不再被问。
6. 作为用户，真正不可逆、影响面超出命令文本可判断范围的操作（如动系统全局配置）仍然 ask，所以降噪不牺牲安全底线。
7. 作为用户，脚本附审对敏感路径文件不生效（内容永不送 LLM 纪律），所以密钥文件不会经这条新路径泄漏给评审 API。
8. 作为用户，超限脚本（>100 行或二进制）维持首审结论不附审，所以复审拿到的永远是完整可信的文本，不是被截断误导的片段。

## Implementation Decisions

- **A1 提示词校准**：替换共享系统提示词（两通道共用，ADR-0024）中 ask 一行，批准文本：

  ```
  - "ask": ONLY when both allow and deny are clearly wrong — e.g. an
    irreversible action whose blast radius you cannot bound from the command
    text alone. Running project scripts, killing processes the agent started,
    cleaning up temp files it created, curling localhost, and other routine
    agent dev-loop operations are "allow". Judge multi-line commands and
    for-loops as a whole; a present loop body is not "incomplete". When merely
    uncertain between allow and ask, choose allow with the higher risk digit.
  ```

  其余行不动。prompt 字节变化使 MIMO/DeepSeek 前缀缓存一次性失效（ADR-0020 先例，自愈）。MIMO 主腿与 DeepSeek 备用腿同时变松是**有意为之**；若日后发现真危险命令被放行，回退即改回这一行。
- **A2 用户规则热修**（本机 ops，非仓库代码）：用户 rules.json 的 staticAllow 追加 `taskkill //PID *`、`taskkill /PID *`、`curl * http://127.0.0.1:*`、`curl * http://localhost:*`、`node scripts/*`（用户已知悉该文件全局生效、跨 workspace 放行 `scripts/` 下脚本，接受此权衡）。`powershell -Command*` 在 alwaysReview 且优先级高于 staticAllow，故 Stop-Process 包裹型救不了——靠 A1 解决，是已知残余。按 ADR-0013，这些数组项不会经 defaults 传播到任何机器，热修就是直接编辑目标机器 rules.json。
- **A3 脚本附审**（grill Round 1 Q1–Q3、Round 2 Q10 定案）：
  - 触发：普通 LLM 审查路径（单命令/复合段/管线叶共用的裁决链）首审结论为 deny 或 ask，且命令呈"解释器+本地脚本"形态。明确排除：敏感路径降级审查（内容永不送 LLM 纪律 + 拒因与脚本内容无关）、目录删除复核（删除命令非解释器形态，天然不触发）、写后执行（`script` 内容已在）、评审器故障（`reviewerFailed` 的 ask/deny 非真实裁决，附审只会加倍超时）。
  - 识别：首 token 在解释器清单（defaults 数据字段，初始 node/python/python3/py/deno/bun/tsx）+ 下一个非 flag token 能解析到**存在的本地文件**。路径解析：绝对路径直接用；相对路径按 workspace 根或复合命令前导 `cd` 段解析；`$VAR` 展不开即跳过。任何位置均可（含系统 Temp）——附内容只会让评审更准，评审员看到恶意内容反而会拒。
  - 限制：整文件 **≤100 行且 ≤16KB 且可按文本解码**（NUL 或不可打印占比过高判二进制）三条件全满足才附；任一超限不附、维持首审结论（不截断——截断片段误导评审员，比不附更糟）。复合命令只附**第一个**可解析到的脚本。
  - 复审恰好一次，结论即终审；按所在路径走正常缓存写回，不另发明策略。附审事实在决策详情中留痕（decision-history 可见"经脚本附审复审"）。
  - 通道复用：脚本文本走评审请求既有的 script 上下文槽（两通道 prompt 组装处均已渲染 "Script being executed" 前缀），不新增 prompt 契约。

## Testing Decisions

- 好测试只断言外部行为：GuardService 以注入 stub reviewer 为最高 seam（先例：guard-service.spec.ts / ask-escape.spec.ts）。
- A3 用例：deny→附审→复审 allow；ask→附审→终审 deny；allow 不触发第二次调用；reviewerFailed 不触发；>100 行不附（首审结论维持）；二进制不附；`$VAR` 路径跳过；复合命令 `cd` 前缀相对路径解析命中；敏感路径降级不触发；写后执行（script 已置）不重复触发；stub 调用计数恰为 2 的断言。
- A1：llm-lang.spec.ts 的按语言 prompt pin 更新（有意快照）；无行为断言变化——语义靠 A3/A2 用例与线上 ask 率观测。
- A2：以 matchPattern 对新模式做真命令样例匹配断言（`taskkill //PID 40136 //F`、`curl -s -m 3 http://127.0.0.1:8600/health` 等来自 decision-history 的实录形态）。
- 观测验收：上线 14 天 ask 率（audit/decision-history）从 2.5% 降到 ≤1.2%。

## Out of Scope

- A4 ask 重复抑制 / allow-once 语义变更（grill 已拒：重复仅 9 次/30 天，且动 ADR-0019 四态语义）。
- 脚本附审推广到敏感路径降级或目录删除复核。
- 主/备用端点或模型更换（仍 MIMO 主 + DeepSeek 备）。
- CLI/TUI 新命令面。

## Further Notes

- 提示词偏松的回退通道：单行改回，随时可调（A1 决策的一部分）。
- 与 0028（删除分级）独立实施、互不阻塞；A1 先上可立即压低 ask 总量。
