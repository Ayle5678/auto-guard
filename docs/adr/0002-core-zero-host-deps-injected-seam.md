# core 零宿主依赖；GuardService.decide 是唯一测试 seam，依赖全注入

`@auto-guard/core` 只依赖 Node 内置模块（可选依赖见 ADR-0005），不得 import 任何宿主 SDK。稳定接口是 `GuardService.decide(GuardRequest): Promise<Decision>`；缓存、规则、reviewer、file tracker 存储、pending map、审计、历史、模板缓存全部经 `GuardDeps` 注入。zcode 版已验证此注入面（SessionCacheLike 放宽、PersistableMap、WriteStore），本决策把它从"移植时的放宽"升格为 core 的正式契约。types.ts 头注的既有承诺（"intentionally have no dependency on host internals"）扩展为包级边界。

## Consequences

- 宿主差异（进程模型、ask UI、通知通道）只能通过注入件与宿主能力声明（ADR-0007）表达，不许在 core 里出现宿主名分支。
- LLM reviewer 核心默认为直连 OpenAI 兼容 HTTP 的 DeepSeekReviewer（node:http/https 一事一连接；不用 undici 池化 fetch——keep-alive 池与 hook 的 process.exit 在 Windows 竞态致 libuv 断言崩溃，见 grill-log Round 7）；dsh 适配层可注入包一层 ctx.llm 路由的实现，接口不变。
