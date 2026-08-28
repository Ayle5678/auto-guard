# 宿主能力模型：ask 风格、通知通道、headless 落点由适配层声明

core 只产出 ask，不决定 ask 如何落地。每个适配层声明 HostCapabilities：`askStyle: 'four-state' | 'native' | 'one-shot'`、`headlessFallback`、`notifyChannels`、`userBash`、`hasUI`。core 的 ask 四态纯逻辑、通知路由纯函数（page/context/off）永远存在，但只在能力匹配时被接线。既有宿主决策原样保留：pi 用四态（ADR-0013）+ `hasUI`/headlessMode；dsh 无 slash 命令、权限预设是唯一启停开关（ADR-0014）、原生 ask→deny 兜底；zcode ask 委托宿主原生确认框、v1 不做四态（ADR-0005）。

## Considered Options

- 借合并统一 ask 体验（如给 zcode 补四态）：拒绝——zcode ADR-0005 已论证重复 ask 由缓存/历史/学习规则逐步赢得放行来缓解，为统一而统一会重开已关闭的决策。

## Consequences

- 新宿主接入 = 写适配层 + 填能力声明，不需要改 core 的任何 if。
- 通知通道实现归适配层（pi ctx.ui.notify/sendMessage、dsh page 事件/context 注入、zcode 决策历史拉式）；core 只提供文案与路由策略。
