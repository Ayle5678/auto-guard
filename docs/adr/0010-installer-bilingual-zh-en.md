# 安装器双语（zh/en）：扁平消息目录 + 交互 init 先选语言，非交互默认中文

安装器（`init` / `list` / `remove`）的全部用户可见文案收敛到一个扁平中英消息目录 `packages/cli/src/installer/i18n.ts`（`message(lang, key, params)`，`{name}` 占位插值，不用 i18n 库——约 50 条短句，保持目录可整体审阅，且 `EN: Record<MessageKey, string>` 由类型系统强制两语言键对齐）。语言解析顺序：`--lang <zh|en>`（接受 `zh-CN`/`en-US` 等区域写法）→ 环境变量 `AUTO_GUARD_LANG`（管理命令未来共用）→ 交互式 `init` 在 TTY 上弹双语提问「请选择语言 / Select language」（回车默认中文，数字与语言名皆可输入）→ 兜底 `zh`。

## Considered Options

- 引入 i18n 框架（i18next 等）：拒绝——CLI 零运行时依赖原则下纯属负担，消息量不值得。
- 交互提示词按 locale 自动猜语言（`Intl`/`LANG`）：拒绝——Windows 上环境变量不可靠，且「先问、默认可回车」已把成本降到一次按键；locale 猜测只作后续可选增强。
- 记住用户选择（持久化偏好文件）：拒绝——spec 0002 约束安装器只写 profile 声明的文件，语言偏好不值得破坏它；init 每机通常只跑一两次，每次选一次可接受。
- 非交互默认跟随 locale / 默认英文：拒绝——兜底 `zh` 让既有管道、CI 与全部存量消费者输出逐字节不变；脚本显式 `--lang en` / `AUTO_GUARD_LANG=en`。
- 管理命令（guard/set/examine/optimize）同步双语：本次不做——它们的文案散在 shell 与 core（`statusLines` 等），是独立的后续迁移。

## Consequences

- 头图永远第一屏：tagline 名字固定中英双行并列（`缓存式自动命令审查 / Cached Auto Command Review`），不随语言渲染变化（初版曾按语言渲染，0.3.x 改名时固定为双行）；语言提问本身也固定双语（此刻语言未知）。
- 纯函数模块（`plan` / `remove` / `detect` / `interactive`）通过 options 接收 `lang`（缺省 `zh`），文案仍是各自函数的产出——目录只管翻译，不管流程。
- profile 的 `sessionNote` 从中文字面量改为消息键（`validateProfile` 校验键存在），新增语言 = 新增一份目录，不动 profile 数据。
- 「无效 `--lang`」报错在语言未知之前发生，固定双语一行。
