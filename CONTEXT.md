# auto-guard

AI 编码 agent 的缓存式自动命令审查工具（Cached Auto Command Review）：在宿主工具执行命令或读写文件之前，用规则、记忆与 LLM 裁决自动给出 allow / deny / ask 的安全网。一个核心裁决引擎服务多个宿主（DSH、Pi、ZCode、Claude Code、OpenCode、Qoder），每宿主一层薄适配。本文件是全域唯一术语表；三前代项目（dsh-auto-guard / pi-auto-guard / zcode-auto-guard）的术语表由本文吸收取代。

## 宿主与适配

**宿主（Host）**:
承载守卫的 AI 编码工具。当前七个：DSH（DeepSeek Harness 插件体系）、Pi（Pi Coding Agent 扩展）、ZCode（PreToolUse hook 插件）、Claude Code（PreToolUse hook）、OpenCode（permission.asked 插件）、Qoder（PreToolUse hook，国际版 IDE）、Codex（OpenAI Codex CLI，hooks.json PreToolUse hook）。
_Avoid_: 平台、客户端、载体

**宿主适配层（Host Adapter）**:
把宿主的工具调用事件翻译成 GuardRequest、把 Decision 翻译回宿主决策协议的薄层。宿主耦合只允许存在于此。
_Avoid_: 集成层、driver、bridge

**宿主能力（Host Capabilities）**:
一个宿主声明自己支持哪些交互特性（ask 风格、通知通道、用户命令拦截、UI 有无）的对象；核心据此调整行为，而不是 if 宿主名。
_Avoid_: feature flags、兼容开关

**宿主运行时（Host Runtime）**:
hook 形态宿主（PreToolUse / permission.asked：stdin 读一次事件、裁决、emit 一次、退出）共享的适配运行时（`packages/host-runtime`）：打包 hook 管线、组合根接线、管理 CLI、输出序列化与语言目录，以宿主描述符为唯一输入。进程内宿主（Pi、DSH）不经它，仅复用其组合根 helper。
_Avoid_: 适配器基类、宿主框架、shared（泛指时）

**宿主描述符（Host Descriptor）**:
一个 hook 宿主全部差异的纯数据声明：hostId、配置根目录、守卫工具名表、路径/内容字段拼写、会话与工作区 env 名、宿主能力值、出口序列化器槽。新 hook 宿主 = 写一个描述符文件，不改运行时代码。
_Avoid_: 宿主 profile（那是安装器的检测/写入数据）、配置文件（那是用户侧的）

**权限预设（Permission Preset）**:
DSH 特有的会话级权限配置选择；选择 `auto-guard` 预设是 DSH 宿主的唯一启停开关。
_Avoid_: 模式、开关（泛指时）

## 裁决

**裁决（Decision）**:
引擎对一次工具调用的完整结论：kind（allow/deny/ask）+ risk（low/medium/high）+ 决策来源 + 一句话理由。
_Avoid_: 判定、verdict、审批结果

**GuardRequest**:
工具无关的待审请求：工具种类（bash/pwsh/write/edit/read）+ 命令或路径内容。适配层的唯一输入协议。
_Avoid_: hook payload、事件

**裁决管线（Decision Pipeline）**:
GuardService 内的固定分层顺序：写后执行 → 绝对黑名单 → 目录删除复核 → 敏感路径 → 复合命令拆分 → 静态放行 → 缓存 → 模板缓存 → 历史层 → LLM 兜底。
_Avoid_: 审查流程、规则链

**决策来源（Decision Source）**:
决策出自哪一层的标签：static-allow / hard-deny / directory-delete / user-confirmed / session-cache / persistent-cache / learned / history / llm / file-tracker / sensitive-path / passthrough / error。
_Avoid_: 规则名、层级号

**fail-closed**:
异常时倾向拒绝（或转人工）而非放行的默认纪律。config 显式关闭时例外——用户关闸必须永远有效。
_Avoid_: 安全默认

**headless fallback**:
宿主没有确认 UI 时 ask 的归宿；由宿主能力声明（dsh 原生 ask→deny、pi headlessMode、zcode/claude/qoder 委托宿主权限系统、opencode 委托宿主 permission.ask 与 TUI、codex ask→deny——其 hook 协议对不支持的 "ask" 会弃用并继续执行，绝不发 ask）。
_Avoid_: 无人值守模式

## 规则

**规则文件（Rules File）**:
九类规则的 JSON 文件：staticAllow、hardDeny、directoryDelete、directoryDeleteGuards、userConfirmed、cacheable、alwaysReview、staticAllowGuards、sensitivePaths。pattern 为大小写不敏感的 glob。
_Avoid_: 规则库、黑白名单（泛指时）

**递归删除守卫（directoryDeleteGuards）**:
目录删除的不变式判定（ADR-0012）：`when` 锚定 glob + 递归 flag 描述（短 flag 聚簇按字母分解、长 flag 整词），命中即归 directory-delete 类别。与按拼写枚举的 directoryDelete 条目互补，枚举只作止血保留。

**静态白名单（static-allow）**:
毫秒级、不经 LLM 直接放行的命令模式（只读、版本查询、git 只读）。
_Avoid_: 白名单（单用时）

**绝对黑名单（hard-deny）**:
无条件拒绝的模式，不可被缓存、学习或 LLM 推翻（`rm -rf /`、`mkfs`）。
_Avoid_: 禁止列表

**必审规则（always-review）**:
每次出现都必须走 LLM、放行结果最多进短时会话缓存的命令模式（安装依赖、提权、内联脚本）。
_Avoid_: 敏感命令

**可缓存规则（cacheable）**:
LLM 放行后结果可写入跨会话持久缓存的命令模式。
_Avoid_: 低风险命令

**预授权（user-confirmed）**:
视作用户已经同意过的命令（如 `git push`），放行但不写缓存。
_Avoid_: 信任命令

**目录删除复核（directory-delete）**:
递归删除目录先拒一次、要求 agent 以删除理由标记重试、再由 LLM 低推理复核恰好一次的流程；任何非 allow 结果转人工。
_Avoid_: 删除拦截

**白名单守卫（static-allow guard）**:
静态白名单命中后的二级检查：按 token 精确扫描危险 flag（`git branch -D` 的 `-D`），命中则降级 LLM。
_Avoid_: 子规则、例外

**敏感路径（sensitive path）**:
触发门禁的路径模式（`.env`、`.ssh/`、`*.pem`）。文件工具命中即 ask 且内容永不送 LLM；shell 命令命中则整条降级 LLM、不拒绝不缓存。
_Avoid_: 隐私路径

**写后执行（file tracker）**:
检测"刚写入的脚本被立即执行"（时间窗内跨命令或同命令）并物化脚本内容送审的机制；内容疑似敏感时不送 LLM。
_Avoid_: 脚本追踪

**复合命令（compound command）**:
含 `;`/`&&`/`||` 的命令；分类取最严子命令，管道不拆（数据在段间流动）。
_Avoid_: 链式命令

## 记忆与学习

**会话缓存（session cache）**:
会话内 LRU，key 为 会话×工作区×命令形态，会话结束即清。
_Avoid_: 内存缓存

**持久缓存（persistent cache）**:
跨会话、按工作区隔离、带 TTL（low 30 天 / medium 7 天 / high 永不）的 JSON 缓存。LLM deny 永不入内。
_Avoid_: 全局缓存

**模板缓存（template cache）**:
按命令骨架存取的学习放行缓存；参数变体（`--days 7` 与 `--days 8`）可命中。
_Avoid_: 模式缓存

**命令骨架（skeleton）**:
命令的 token 级结构：保留命令名、flag、管道与重定向，易变参数替换为类型化占位符（`<str>/<path>/<num>…`）。历史层与学习规则共同的最小分组单位。
_Avoid_: 指纹、哈希

**历史判断层（history layer）**:
运行时查自家审计库：同一骨架近期多次低风险放行且零拒绝（阈值可配）即免 LLM 放行，只写会话缓存。
_Avoid_: 历史缓存

**学习规则（learned rules）**:
离线确定性分析审计库生成的 cacheable 模板（绝不学 static-allow），全量覆盖写盘、带备份回滚、加载期再过滤。
_Avoid_: 自动规则、AI 规则

**Guard Memory**:
LLM deny 后不写缓存、同命令重现将转人工 ask 的记忆；审查器故障不入记忆。
_Avoid_: deny 缓存、黑名单记忆

**ask 四态（four-state ask）**:
确认框的四个选项：仅本次同意 / 本会话都同意 / 拒绝（可输原因）/ 本会话都拒绝。仅 ask 风格为四态的宿主启用。
_Avoid_: 快速选择

**删除理由标记（deletion marker）**:
agent 重试目录删除时命令中携带的 `[删除理由] <原因>` 供词标记；裁决前会被剥离。
_Avoid_: 删除前缀

## 审计与观测

**审计库（audit store）**:
本地加密 SQLite，记录 shell 裁决（不含文件工具、不含执行输出），落库前脱敏。实验性、默认关闭。历史层与学习规则的数据源。
_Avoid_: 日志、guard-examine（命令名不是概念）

**决策历史（decision history）**:
最近裁决的环形 JSONL 文件，每条含命中详情（规则 pattern / 缓存层 / LLM 判词），供 `guard recent` 拉式查看；为无推送通道的宿主替代页面通知。
_Avoid_: 审计（那是审计库）

**守卫统计（guard stats）**:
会话内各层命中计数（llmCalls、各缓存命中、规则命中），内存态、不落盘。
_Avoid_: 用量统计

## 配置与安装

**配置根（config root）**:
每宿主独立的数据目录（`~/.dsh/auto-guard/` 等）。宿主之间零共享；路径不变保证旧用户零迁移。
_Avoid_: 共享配置、home 目录

**播种（provisioning）**:
首次运行把出厂规则复制为可编辑的 defaults.json，并把用户 rules.json 缺失字段自动补齐回写。
_Avoid_: 初始化（泛指时）

**规则双层文件（rule file layers）**:
每个配置根里两层生效文件：defaults.json（播种的出厂拷贝，可编辑）与 rules.json（用户覆盖）。加载时用户文件的字段**整体胜出**，仅缺失的顶层字段才从出厂侧补齐——新出厂模式不会自动进入存量安装的已有数组（见 ADR-0013）。
_Avoid_: 规则合并、配置继承

**key 水合（key hydration）**:
API key 的解析顺序：环境变量 > 加密存储 > 遗留明文字段。只在内存水合，不回写明文。
_Avoid_: key 加载

**安装器（installer）**:
`auto-guard init`：检测本机宿主、交互多选、按宿主 profile 写入集成；配套 `auto-guard remove` 完整卸载。
_Avoid_: setup 脚本

**宿主 profile（host profile）**:
安装器中描述一个宿主如何被检测、往哪里写什么集成内容的数据条目；新增宿主优先加 profile 而非改安装器代码。
_Avoid_: 适配器（那是代码层）

**语言设置（language setting）**:
用户可见文案的输出语言（中/英），四层解析：`AUTO_GUARD_LANG` 环境变量 > 每宿主配置 > 机器默认语言 > 中文兜底。安装时选定，之后一直生效，可单独更改。
_Avoid_: locale、i18n（那是实现机制）

**机器默认语言（machine default language）**:
安装器写入 auto-guard 自身命名空间的机器级语言偏好；未显式配置的宿主与尚未播种的配置根都跟随它，使「安装时选一次」对全机生效。
_Avoid_: 全局配置根（配置根都是每宿主的）

**消息目录（message catalog）**:
一个包的中英扁平文案字典，键一致、类型系统强制对齐；文案归各包所有，跨包只共享取词函数。
_Avoid_: i18n 资源文件、翻译文件

**裁决理由（decision reason）**:
裁决附带你的一句话解释，进入决策历史与会话缓存。语言跟随语言设置；已存历史记录不随设置翻译。
_Avoid_: 判词、说明

**删除理由标记（delete-reason marker）**:
目录删除被复核拒绝后，用户在原命令上附带的协议标记（`[删除理由] <理由>`），引擎按字面解析后交 LLM 复核。是协议不是文案，不参与双语。
_Avoid_: 删除前缀、注释语法

## 工具与界面

**TUI 控制台（Guard TUI / auto-guard-tui）**:
全屏交互管理控制台（`packages/tui`，SPEC 0009 / ADR-0014）：覆盖安装器与 guard/set/examine/optimize 全部命令面，主要服务宿主无设置 UI 的用户。零运行时依赖、手写 ANSI 渲染；所有动作经 `runCli`/`runInstallerCommand` 执行，语义与 CLI 单一事实源。
_Avoid_: 设置界面（那是 DSH 宿主的）、GUI

**帧渲染器（frame renderer）**:
TUI 的唯一渲染出口：`render(state) → string[]`（styled 行数组）。驱动层做行级 diff 重绘；组件全是纯函数，可在无终端环境下测试。
_Avoid_: 组件树、虚拟 DOM

**命令模式（command mode）**:
TUI 内按 `:` 呼出的任意命令通道：空格分割 argv，`init|list|remove` 走安装器、其余走管理 CLI（自动补当前 `--config-root`），回执进日志屏。全命令面的保底通道。
_Avoid_: shell 模式、终端模拟

**回执（receipt）**:
一次命令执行的可见结果：命令 + 退出码 + 双语输出。命令记录用户视角的 argv（注入的 `--config-root` 只存在于实际执行调用）。进 footer（最近一条）、日志屏（流水）与所在屏输出面板（最近一条）。退出码着色（0 绿 / 非 0 红）。
_Avoid_: toast、通知

**输出面板（output pane）**:
列表屏与安装屏右侧的命令输出视口：内容 = 最近回执或只读自动加载结果；超宽行折行不静默截断（SPEC 0011），PgUp/PgDn/g/G 滚动、新回执贴底。日志屏是全量流水的可滚表面。
_Avoid_: 终端模拟、控制台区

**自动加载（autoload）**:
列表屏首次进入自动执行的只读命令（`guard recent 10`、`examine/optimize status`、`set show-key`、安装 `list`），用于填输出面板；不写回执、不进日志屏（日志 = 用户显式动作 + 命令模式）。
_Avoid_: 后台刷新、轮询
