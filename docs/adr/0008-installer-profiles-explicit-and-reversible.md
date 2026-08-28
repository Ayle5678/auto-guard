# 安装器 profile 数据驱动；写入显式、幂等、可完全卸载

`auto-guard init` / `auto-guard remove` 是唯一安装器（Node CLI、零外部依赖）。宿主接入方式描述为数据 profile（检测特征、写入位置、集成内容模板），新宿主优先加 profile 而非改安装器代码。安装器**显式写入**用户配置（写前备份 `*.auto-guard.bak`、幂等、`remove` 还原），不伪装成"只读"工具——守卫必须写配置才能生效，这是与 caveman（配置只读/临时合并）的本质差异，诚实面对。

模式综合：headroom 的 `wrap <agent>` 选择体验 + caveman 的 profiles 数据结构 + 自动检测已装宿主。

## Considered Options

- 各宿主只用原生渠道（dsh plugin add / pi install / zcode 插件管理）：继续可用且互不排斥，安装器是快捷方式不是唯一路径。
- 安装器代装各宿主本身：拒绝——超出职责，只检测不安装宿主。

## Consequences

- 检测基于目录特征（`~/.dsh`、`~/.pi`、`~/.zcode/cli/config.json`），误检可在交互中人工否决。
- zcode hooks 无热重载：init 完成后须提示新开会话。
