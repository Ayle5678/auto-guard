# 宿主运行时：hook 形态宿主共享一套适配运行时，宿主差异退化为宿主描述符

四个 hook 形态宿主（ZCode、Claude Code、Qoder、OpenCode）的宿主适配层各自 ~1100 行，其中约八成是跨宿主逐字拷贝：claude↔qoder↔opencode 的 cli.ts 规范化后仅差一行注释，GuardDeps 组合根接线写了六遍、conformance 又写第七遍，17 个同名函数在四个宿主各定义一次。拷贝税不是假设而是事实：ADR-0011 语言层只落进 zcode/pi/dsh，claude/qoder/opencode 把同一批中文串硬编码成第四份拷贝；conformance 甚至把 qoder≡claude 序列化器钉死为逐字节相同——把重复制度化。

新增 `packages/host-runtime`（`@auto-guard/host-runtime`，仅依赖 core、零宿主 SDK）：打包 hook 管线（stdin→裁决→emit）、组合根接线、管理 CLI、输出序列化与语言目录，唯一入口 `createHookHost(宿主描述符)`。宿主差异退化为纯数据描述符——hostId、配置根目录、守卫工具名表（含 qoder `delete_file` 的 bash `rm` 合成）、路径/内容字段拼写防御链、会话与工作区 env 名、宿主能力值——加一个出口序列化器槽（opencode 的 `{status,reason}` 契约由此注入）与可选目录扩展。四个宿主包保留为薄门面（描述符 + dist 入口重导出），安装器 profile 与已装用户零感知；新 hook 宿主 = 写一个描述符文件。进程内宿主（Pi、DSH）不经它，仅复用其单独导出的 `buildGuardDeps` 组合根 helper。

## Considered Options

- 维持逐宿主拷贝、靠 conformance 钉等价：拒绝——漂移已经发生（语言层 3/6 落地），第 7 个 hook 宿主要再抄 ~1250 行；逐字节 pin 只能证明拷贝没走样，不能阻止能力漂移。
- 共享代码下沉 core：拒绝——违反 ADR-0002（core 零宿主依赖）；hook 管线与出口序列化是适配层的事。
- 连 Pi/DSH 一起收编：拒绝——进程内常驻、事件回调、有 UI 是另一个形态，它们的 seam 是 core 的 decide + 注入件（ADR-0002 本就如此）；为一个运行时统一两个形态是为统一而统一（ADR-0007 Considered 先例）。
- 安装器直指运行时、宿主包消失：拒绝——要改 profile 面与产物路径、已装用户全量迁移，违背 ADR-0003「路径不变、零迁移」精神，无对价收益。

## Consequences

- 语言层以 zcode 版为基底（延续 ADR-0009「最新最全为基底」先例），claude/qoder/opencode 随合并获得四层解析、`set lang` 与交互向导；中文兜底保证默认输出逐字节不变，已 `set lang` 的宿主拿到本应生效的英文——修 bug 而非破坏。
- 测试面随 implementation 归一：fail-closed 阶梯、管线等价、语言回归成为运行时的参数化契约测试（四描述符各跑一遍），宿主包只剩描述符形状测试；conformance 的 qoder≡claude 逐字节 pin 在迁移期保留为检查点、末票删除，换成「描述符差异只应体现在声明数据」的契约测试。
- 描述符若开始长行为函数（超出序列化器槽）即是 seam 放错的信号，需回本 ADR 重审。
- 发布面多一个 workspace 包；pi/dsh 为 buildGuardDeps 各增一条 workspace 内部依赖边。
- 迁移纪律（SPEC 0013 五票）：每票切换前后 conformance 全量绿；门面 dist 路径不变，安装器与 smoke 脚本零改动。
