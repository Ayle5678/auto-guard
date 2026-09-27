# Grill Log — auto-guard 统一合并设计

2026-08-28。按 grilling 流程自问自答（用户委托全部决策权），每轮把 frontier 问完、给出推荐答案并自答。这里是 ADR 背后的完整推理；ADR 只记结论。

## Round 1 — 仓库形态

**Q1 合并的物理形态是什么？共享 npm 包、继续复制移植、还是 monorepo？**
➡️ 自答：**pnpm workspace monorepo**。三代项目本就是同一条管线（dsh→pi→zcode 逐代复制），zcode ADR-0001 已明确承认复制模式的两份核心需手工同步是税；抽"独立共享包 + 三个宿主仓库"会把一次跨宿主改动变成三次发布流程；monorepo 让"同步"退化为一次提交，同时保留每宿主独立打包（dsh 插件清单、pi jiti 入口、zcode dist 构建）的能力。
拒绝项：继续复制移植（税已被 zcode ADR-0001 记录，合并的目的就是消灭它）；单包多入口（dsh 的 peerDependencies 会污染 zcode 的零依赖约束）。
**Supersedes**：zcode ADR-0001（copied-core-not-shared-package）、pi ADR-0001（independent port）——它们的"推迟共享"条件（两个宿主稳定）已满足，现在是三个。

**Q2 新项目叫什么？**
➡️ 自答：**auto-guard**（用户已建同名目录）。npm 组织 `@auto-guard/*`（core、host-dsh、host-pi、host-zcode），CLI bin 名 `auto-guard`。

**Q3 工程约定（tracker / labels / 域文档布局）？**
➡️ 自答：沿用三前代一致的 `.scratch/` 本地 markdown 约定（无远端，specs/tickets 习惯可直接搬）；triage 标签用五个默认角色；single-context（packages 是技术切分不是领域切分，一份 CONTEXT.md + docs/adr/ 覆盖全部）。入口文件选 AGENTS.md（中性，契合多宿主项目气质）。

## Round 2 — 核心引擎边界

**Q4 core 的稳定 seam 是什么？**
➡️ 自答：`GuardService.decide(GuardRequest): Promise<Decision>` + 全注入 `GuardDeps`（缓存、规则、reviewer、file tracker store、pending map、审计、历史、模板缓存）。zcode 版已证明这套注入化可行（SessionCacheLike 放宽、PersistableMap、WriteStore 都是它引入的），把 zcode 的注入面升格为 core 的正式接口即可，dsh/pi 两个长驻进程宿主直接传内存实现。

**Q5 会话状态怎么抽象？一次一进程（zcode）与长驻进程（dsh/pi）如何共存？**
➡️ 自答：core 定义会话态组件接口（session cache、tracker store、pending sinks），提供两个实现：**内存实现**（dsh/pi，进程活着态就在）与**磁盘实现**（把 zcode 的 session-store/persist-map 提升进 core，写透 JSON、TTL 剪枝、闲置剪枝）。宿主 bootstrap 按自己进程模型选实现，守卫逻辑对存储位置无感知。
拒绝项：只保留内存实现（zcode 会静默丢状态，违反其 ADR-0003）；只保留磁盘实现（给 dsh/pi 每命令增加无谓 IO）。

**Q6 审计库选型？dsh 0.2.0 刚迁到 SQLCipher 全库加密，zcode 是 node:sqlite + 字段级 AES-GCM。**
➡️ 自答：**AuditStore 接口 + 双实现**。`SqlcipherAuditStore`（better-sqlite3-multiple-ciphers，全库加密，dsh/pi 使用）与 `LightAuditStore`（node:sqlite WAL + 字段级 AES-GCM，zcode 零 native 依赖约束下使用）。两实现共用脱敏、schema（18 列）、迁移与维护操作；历史层/学习规则只依赖接口。
拒绝项：全统一 SQLCipher（zcode 插件被迫带 native 依赖，破坏其安装简单性）；全统一 node:sqlite 字段加密（推翻 dsh 0.2.0 刚完成的迁移，且全库加密强度更高）。"细节按最新"在两个最新相互冲突时，取"能力强的最新 + 接口隔离"。

**Q7 API key 管理统一到哪个方案？**
➡️ 自答：以 zcode ADR-0006 为基底统一：core 提供 key-store（AES-256-GCM 机器绑定加密）+ **水合链 `env > 加密存储 > 遗留明文`**。pi 由此从明文 config.json 升级到加密存储（pi 的弱点是已知债）；dsh 适配层把 settings secret role 挂进同一条水合链；TTY 交互式 set-key 向导放统一 CLI。

**Q8 规则文件与配置 schema 如何统一？**
➡️ 自答：`RulesFile`（8 类规则）与 `GuardConfig`（zcode 版 38 键为基底）取**超集**为唯一 schema；defaults/rules.json 取三库**并集**后人工复审去重（三份本就同源，差异多为各自加的条目）。dsh 特有键（provider/reasoningEffort/fallbackProvider、notify page/context 细分）进超集，其他宿主不用即是。各宿主仍播种到**各自**配置根（见 Q10）。

## Round 3 — 宿主差异放哪里

**Q9 宿主差异中哪些必须保留在适配层、哪些应该被核心吸收？**
➡️ 自答：吸收进 core 的：裁决管线、规则、缓存、骨架/历史/学习、审计、key 水合、通知路由纯函数、ask 四态纯逻辑、决策历史、管理 CLI 的操作层。保留在适配层的：事件接线（dsh pre-execute / pi tool_call+user_bash / zcode PreToolUse stdin-stdout）、决策协议翻译、ask 交互实现、通知通道实现、配置系统挂载（dsh settings namespace / pi config.json / zcode config.json+加密 key）、打包形态。判据：与"宿主 SDK 类型或进程模型"耦合的留适配层，纯逻辑进 core。

**Q10 配置根统一成一个还是继续分宿主？**
➡️ 自答：**继续 `~/.dsh/auto-guard/`、`~/.pi/auto-guard/`、`~/.zcode/auto-guard/` 三根隔离**（zcode ADR-0002、pi ADR-0003 的既有决策），路径不变意味着三库现有用户**零迁移**——升级只是换代码不动数据。跨宿主共享缓存预热只作为未来 opt-in 导入导出桥，不做自动共享。

**Q11 zcode 的 ask 四态记忆要不要借合并之机补上？**
➡️ 自答：**不补，维持 zcode ADR-0005（ask 委托宿主原生确认框）**。四态纯逻辑已在 core，能力开关（askStyle）决定谁用：pi 用四态，zcode 委托原生，dsh 用宿主一次性审批语义。重复 ask 的痛点由缓存/历史/学习规则逐步赢得放行来缓解——这是已验证的路径，不为统一而统一。

**Q12 dsh 无 slash 命令、zcode/pi 有命令，统一命令面吗？**
➡️ 自答：**不统一注册，统一操作层**。core 提供命令操作函数（status/stats/ping/set-key/set-api/examine/optimize/recent），pi/zcode 的 slash 命令和 dsh 的设置 UI + Typert remote 都只是这层操作的皮。dsh 维持其"权限预设是唯一启停开关"的决策（dsh ADR-0014）。

**Q13 headless（无 UI）语义差异怎么处理？**
➡️ 自答：core 只产出 ask；落点由宿主能力声明：dsh 原生 ask→deny（fail-closed）、pi `hasUI + headlessMode`（默认 deny）、zcode hook ask 交给宿主权限系统。core 的 `onTimeout`（默认 deny）保持服务级兜底不变。

## Round 4 — 安装器

**Q14 安装器长什么样？**
➡️ 自答：`auto-guard init` / `auto-guard remove` 一个 Node CLI（无外部依赖）。行为综合 headroom 与 caveman 两模式：**检测**本机已装宿主（`~/.dsh`、`~/.pi`、`~/.zcode` 目录特征）→ **交互多选**（也支持 `--host dsh,pi` 非交互）→ **按 profile 写入**各宿主集成（dsh：plugin 注册；pi：settings.json extensions 路径；zcode：hooks 写 `~/.zcode/cli/config.json`）。宿主接入方式描述为**数据 profile**（检测路径、写入位置、集成模板），新宿主优先加 profile 而非改安装器代码（caveman 的 agents/profiles 模式）。

**Q15 安装器直接改用户配置文件，怎么防止帮倒忙？**
➡️ 自答：写前备份（`*.auto-guard.bak`）、幂等（重复运行结果一致）、`remove` 完整卸载、绝不触碰 profile 之外的文件。各宿主原生安装渠道（dsh plugin add、pi install、zcode 插件管理）继续可用——安装器是快捷方式，不是唯一路径。

## Round 5 — 收尾

**Q16 起始版本与旧仓库处置？**
➡️ 自答：统一后起始版本 **0.3.0**（延续 dsh 0.2.0 主线语义，zcode/pi 为 0.1.x 的直接继承者）。三个旧仓库冻结归档，README 顶部指向本仓库；因配置根路径不变，"迁移"= 卸旧装新，数据原地续用。

**Q17 "细节按最新"的具体清单？**
➡️ 自答：timeoutMs 3000→**8000**（zcode）；审计 SQLCipher（dsh 0.2.0）；学习规则 **cacheable-only** 加固与加载期去重（dsh/pi 0.1.3+）；管道叶子确定性放行、shell 敏感路径守卫（dsh 0005）；决策历史 + guard recent + hitDetail（zcode HEAD）；加密 set-key 三步向导（zcode）；headless 移除 dsh 遗留 headlessMode 字段以外的分歧；通知默认 allow=page / deny=ask=context。

## Round 6 — 递归删除与规则升级（2026-08-29 事后补，Qoder 实测发现裸 rm -r 缺口）

**Q18 裸 `rm -r`（无 -f）为什么绕过了目录删除复核？怎么修？**
➡️ 自答：`directoryDelete` 默认只枚举了 `rm -rf *` / `rm -fr *` 等拼写，裸 `rm -r` 不匹配任何类别落 `unknown` → LLM low-risk 放行 → 写 30 天持久缓存，重放免审（缓存文件实测坐实）。止血：`directoryDelete` 与 `alwaysReview` 补 `rm -r *` / `rm --recursive *`（glob 大小写不敏感连带 `-R`），回归测试钉死「裸 rm -r 走理由流、不写持久缓存」。长期判定语义转**不变式**：rm + 任意拼写递归 flag ⇒ directory-delete，落地为 staticAllowGuards 式 when+flag 机制加**短 flag 聚簇分解**（`-rf` 按字母分解含 `r` 即命中），数据仍住 rules.json（ADR-0012）。
拒绝项：继续纯枚举（`rm -f -r`、`rm -rF` 排列发散，已经漏过一次）。

**Q19 递归删除判定要不要上 AST / shell 解析器？**
➡️ 自答：**不要**。core 零 npm 运行时依赖（ADR-0002）不容解析器；这是词汇判定（命令词挂没挂递归 flag）不是句法判定，AST 后仍要遍历取同样的 token 事实；解析失败照样要 LLM 兜底；shell 分词/展开使解析树 ≠ 执行语义（`X='-rf'; rm $X dir`），那类本就归变量替换检测 → LLM。结构危险场景的既有出路（引号感知拆分、替换检测、送 LLM）已是正确粒度。

**Q20 新出厂规则如何到达存量安装？运行时自动合并吗？**
➡️ 自答：**不自动合并，维持「用户字段整体胜出 + 只补缺失顶层字段」**，它是 ADR-0008 显式写入的一致推论（静默改写用户规则违背显式性，且无墓碑防「故意删除的模式复活」——注意 rules.json 常是全量数组而非稀疏覆盖，本次实测坐实）。升级走 init 显式步骤：检测出厂默认含本地缺失模式 → diff 预览 → 确认后幂等追加 + 去重 + `*.auto-guard.bak` 备份（ADR-0013）。本次三宿主六份文件的手工同步就是该流程的首次人工执行。
拒绝项：加载期自动追加（魔法 + 墓碑语义）；「重装即升级」的说法（播种对已存在文件是 no-op，说法与行为不符）。

## Round 7 — hook 进程 LLM 裁决后 libuv 断言崩溃（2026-08-29 事后补，Qoder 实测）

**Q21 hook 进程为何在 LLM 裁决后以 0xC0000409（STATUS_STACK_BUFFER_OVERRUN/abort）退出，stderr 报 `uv_async_send` 断言（src\win\async.c:94）？**
➡️ 自答：与 auto-guard 的裁决逻辑、stdout 写入、退出策略都无关。根因是全局 `fetch`（undici）的 keep-alive 池化连接在 Windows 上与 `process.exit()` 的竞态：响应结束连接回池（unref'd socket + 保活定时器），exit 触发的 libuv 拆卸期仍有代码向已进入 `UV_HANDLE_CLOSING` 的内部 async 句柄发信号 → 断言 abort。实证收敛四组：池化 fetch + exit 崩 **22/22**（裸脚本真实 API 10/10、12/12）；`node:https` 一事一连接（agent:false）+ exit **0/12**；服务器不回池的快速 401 响应 **0/20**；fetch 请求加 `Connection: close` 头无效（undici 按 fetch 规范剥掉）**12/12 崩**。修复落在 core 单点：新增 `httpPostText`（node:http/https，`agent: false`，连接随响应关闭，零退出延迟），`DeepSeekReviewer.ping/call` 与 dsh 直连路径换轨；宿主 emit 的 flush-后-exit 策略保持不变（它从来不是凶手）。修复后 live 反馈循环 **0/30**（30/30 真实走 LLM 路径），修复前同循环 30/30 崩。
拒绝项：exit 前延时 250ms（实测 3/30 仍崩，治标不治根）；改自然退出（多等 ~1s 保活定时器到期，慢且未除根）；exit 前手动 destroy 池内 socket（现代 Node 的 `_getActiveHandles` 已列不出目标 socket/Timer，够不着；且 destroy 本身制造关闭期活动，裸脚本 10/10 仍崩）。

**Q22 reviewer 测试的 seam 为何从 fetch 桩迁到本地 mock server？**
➡️ 自答：传输层换 node:http 后 `vi.stubGlobal('fetch')` 拦截不到任何东西，残留的桩会让测试真实出网（zcode 用例实测打到真 API 收 401 而失败）。本地 127.0.0.1 mock server 是诚实 seam——测试真正跑到新传输路径，且与崩溃本身的网络形态一致。迁移四个文件：core `llm.spec.ts`（新增 tests/helpers/chat-mock.ts）、`llm-lang.spec.ts`、host-pi `session-ui-lang.spec.ts`、host-zcode `zcode-cli-lang.spec.ts`。
拒绝项：给 reviewer 加 transport 注入参数（为测试污染公共 API，且注入桩又回到"不跑真传输"的老路）。

## Round 8 — Guard TUI 全屏控制台（2026-08-30，SPEC 0009 / ADR-0014）

**Q23 参考物是 ccstatusline（React/Ink），为什么 TUI 不用 Ink 而手写 ANSI？**
➡️ 自答：**零运行时依赖是本仓库的一贯纪律**（core 仅内置模块、cli 仅 workspace 依赖、安装器手写 readline 交互），一个安全网工具不应为一个 UI 引入 React 运行时与其供应链；双语界面必须自己做 CJK 宽度对齐（通用组件库也常做错，混排错位是「精美」的第一杀手）；且纯函数 `render(state) → string[]` 让整套 UI 可在无终端的 CI 里做断言测试。代价是自绘组件的一次性成本，用「组件层只有十来个纯函数」封顶；ccstatusline 借鉴的是它的**体验模式**（全屏、powerline 头、实时预览、危险操作守卫确认），不是它的技术栈。
拒绝项：Ink/React（依赖纪律 + 供应链 + CJK 对齐 + 可测性四条全踩）；blessed（已停维、巨型 API、Windows 行为玄学）；Web/HTTUI（引入浏览器依赖，偏离终端工具定位）。

**Q24 TUI 与既有命令语义的关系——重写一层还是代理一层？**
➡️ 自答：**全部动作代理 `runCli` / `runInstallerCommand`，TUI 零重写**。管理命令 = `runCli([...argv, '--config-root', root])`，安装器 = `runInstallerCommand(['init','--host',…,'--yes',…])`。回执（退出码 + 双语输出）原样进日志屏。理由：语义只有一份，CLI 已有的注入化测试（CliDeps/InstallerDeps）直接成为 TUI 动作层的测试 seam；TUI 若重写开关/清理/回滚逻辑，第一个 bug 就是两份语义漂移。结构化读（状态卡、安装计划预览）才直接调 core/cli 读函数。
拒绝项：TUI 内实现第二套操作逻辑（漂移税永久化）；TUI spawn 子进程跑 `auto-guard` bin（多一层进程 + Windows 退出码/编码坑，且丢注入测试能力）。

**Q25 `set set-key` 在统一 CLI 里是无条件拒绝的（与 docs/cli.md 三步向导的说法不符），TUI 怎么办？**
➡️ 自答：向导真身只在 host-zcode 旧 `cli.ts`（`setKeyInteractive`），统一 CLI 的 shell.ts 该分支**无条件**打印 needs-TTY 退出 2——建票时发现的文档-实现不一致。TUI **不修 cli 也不复用死路**，按向导语义自实现（base → model → 掩码 key，校验对齐：base 须 http(s)、key trim 后 ≥8 字符无空白，Enter 保留现值），保存走 core `saveApiKey` + `applySetApi`。差异记录进 SPEC 0009，统一 CLI 的修复另开后续票，不混入本特性。
拒绝项：顺手修 cli（范围蠕变，TUI 分支动管理命令语义需独立评审）；TUI 也拒绝 set-key（那 TUI 就覆盖不了命令面清单）。

**Q26 安装器的交互如何进 TUI？`--yes` 会不会绕过安全确认？**
➡️ 自答：TUI 用 `detectHosts`/`buildInitPlan`/`buildRuleUpdatePlan` 自己渲染**等价预览**（备份步骤、写入目标、规则 diff 摘要、ADR-0013 的 update/skip 显式选择），用户在 TUI 确认框拍板后才执行 `init --host … --yes`——`--yes` 跳过的只是 CLI 行式确认，安全语义（预览→确认→备份强制）在 TUI 侧完整保留。remove 同理（仅已集成宿主可选 + 红框确认）。语言选择在机器无默认且 env 未设时先问一次并写机器默认（ADR-0011），之后不再问。
拒绝项：把 readline 行式交互搬进 raw mode TUI（readline 与按键捕获互斥）；不做预览直接 `--yes`（丢失 SPEC 0002 的 diff-before-write 承诺）。

**Q27 非 TTY / dumb 终端 / 管道下 TUI 的行为？**
➡️ 自答：拒绝启动、打印等价 CLI 命令提示、exit 2——与安装器非 TTY 拒绝、fail-closed 纪律同构。`TERM=dumb` 同拒；`NO_COLOR` 不拒（无色但可用）。SSR/agent 场景本来就该走 CLI，TUI 是给人看的。
拒绝项：降级为行式 UI（两套交互代码路径，维护面翻倍）；静默挂起等输入（管道下最恶劣的失败模式）。

**Q28 Windows 终端矩阵与退出纪律？**
➡️ 自答：要求 VT 转义支持（Windows Terminal / Git Bash / ConEmu / mintty / 常见 SSH 全部满足；老 conhost 需系统 VT 开启）。退出三恢复（主屏缓冲、光标可见、回显 + raw mode 复位）挂 `process.on('exit')` 兜底；进程退出沿用 `process.exitCode` 自然退出纪律——reviewer 传输层已是 one-shot `httpPostText`（Round 7），无 keep-alive 悬挂，安全。resize 用 SIGWINCH + 500ms 轮询双保险（Windows 下 SIGWINCH 覆盖不全）。
拒绝项：`process.exit()` 硬退（Round 7 的教训；且跳过 exit 钩子会留下坏终端）；假设单次 SIGWINCH 足够（实测 Windows 终端拖拽resize 事件粒度不稳）。

**Q29 为什么 `:` 命令模式是「全命令面保底」而不是锦上添花？**
➡️ 自答：专属控件覆盖高频路径（开关、向导、清理、安装），但命令面会持续演化（未来新组新动作、新 flag）；`:` 模式把 argv 直通 runCli/runInstallerCommand，**任何 CLI 能做的事 TUI 都能做**，「覆盖 100% 命令面」从一次性验收变成结构性保证。代价只是要防密钥类命令进日志——runCli 输出本身已脱敏（maskKey），TUI 不额外回显 argv 中的秘密（set-key 向导不走 argv，天然安全）。
拒绝项：为每个命令做专属控件（控件数量随命令面线性膨胀，v1 交付不了）；`:` 模式做成完整 shell（引号/管道语义是另一个项目）。

**Q30 TUI 的语言跟谁走？总览聚合视图怎么处理多根多语言？**
➡️ 自答：TUI 铬件语言按 ADR-0011 四层解析（env > 当前根 config.lang > 机器默认 > zh），切根即可能换语言（与 CLI 每次调用的解析一致）；总览屏是**读视图**，每张卡显示该根自己的语言行（与聚合 `guard status` 每根一行 `lang : en` 的既有行为一致），铬件语言跟当前选中根。`set lang` 动作后下一帧整屏跟随。
拒绝项：TUI 独立语言设置（第五层出现，违反四层解析的唯一性）；聚合视图强制统一语言（丢失「每宿主可选不同语言」的既有事实）。

## Round 9 — Guard TUI 交互与视觉 2.0（2026-08-30，SPEC 0010）

> 起因：用户真终端验收 0009 后三点不满——(1) 没有设计的 auto-guard 标题/banner；(2) 一些按键存在但无任何有效输出，输出框空置；(3) 数字键 1-8 切页不合理，至少应方向键在页面栏切换；整体再精美一点。本轮为**自问自答**（用户授权代答），三轮收敛。

**Q1 迭代范围动不动？**
➡️ 自答：锁定 `packages/tui` + 测试 + 文档；零新依赖；core 零改动；cli 最多加**纯函数导出**（banner 字形网格，行为零变化）。理由：ADR-0002/0014 纪律与 Round 8 全部结论继续有效，本次是交互/视觉层迭代，不是架构层。
拒绝项：重写渲染层；引入任何 UI 运行时。

**Q2 主切屏方式？**
➡️ 自答：`←→`（及 `h/l`）升级为**全局切屏**（循环、页签高亮跟随），数字 `1-8` 降级为快捷键保留，footer/帮助同步改写。用户原话是"至少应该用方向键在上方的页面栏来切换"。
拒绝项：两段式"聚焦页签栏再 Enter"（多一次按键）；只加 Tab 循环（方向键语义仍缺）。

**Q3 安装屏子页签（init/status/remove）改绑什么？←→ 全局化后的冲突。**
➡️ 自答：`Tab` / `Shift+Tab`。对话框/输入框打开时本就优先接管按键，无冲突；语义直白。
拒绝项：`,/.`（难发现）；`[/]`（部分布局要 Shift）；←→ 在安装屏保留局部语义（恰是本次要消灭的不一致）。

**Q4 输出框空置怎么消灭？**
➡️ 自答：每屏首次进入**自动加载只读命令**：guard→`guard recent 10`、examine→`examine status`、optimize→`optimize status`、set→`set show-key`、安装 status 子页→`list`；`r` 重跑；autoload **不进日志屏**（日志 = 用户显式动作 + `:` 模式）；加载期置 busy（本地读，几十毫秒）天然串行化防竞态。仍走 `runCli`，单一语义来源不破。
拒绝项：TUI 侧重写 status 渲染（语义漂移税）；autoload 也写日志（噪声）。

**Q5 状态信息归位？**
➡️ 自答：guard/set 屏顶部松散裸文本状态条收进左侧**带标题「状态」面板**（动作列表上方）；examine/optimize 补同款状态面板（数据源 = 既有 `RootSummary` 结构化读：examineEnabled / auditCount）。信息架构统一：左 = 状态 + 动作，右 = 输出。
拒绝项：把状态塞进输出面板（与 autoload 内容混排，双列语义丢失）。

**Q6 banner 方案？**
➡️ 自答：品牌两件套——(a) 所有屏持久顶栏品牌 chip 重设计为大写 `AUTO GUARD` 强调色块；(b) 总览屏顶部放**与安装器同款 ANSI Shadow 渐变 AUTO GUARD 字标**（cli banner 模块导出素字形网格，TUI 侧 Seg 化上色），终端 ≥110×20 显示、更小自动隐藏（实施修正：字标 AUTO / GUARD 同幅并排整幅 108 列，62 的预估只算了 GUARD 单词；随预览生成发现截断即修正）。品牌资产复用 + 响应式降级（40×12 最小窗口纪律不破）。
拒绝项：全屏启动 splash（浪费时间）；3 行小方块 logo（撑不起"设计"）；PUA powerline 箭头字形（非 Nerd Font 终端豆腐块）。

**Q7 死键策略？**
➡️ 自答：未绑定键保持静默（vim 惯例）；新增轻量 **notice 系统**——切屏/刷新/换根/取消确认等非命令动作在 footer 左侧闪提示，下一次按键即消失（零定时器）；帮助屏改写到 100% 准确。"按键存在但没反应"的正确修法是让声称的键全部生效 + 帮助如实，而非给死键报警。
拒绝项：每个死键闪"无操作"（噪声）。

**Q8–Q15 视觉细节批量自答**（Round 2，由上解锁）：
➡️ 页签 = 强调色药丸、数字保留药丸内（Q8）；面板/对话框边框圆角化 `╭╮╰╯`（同 U+250x 块、单宽零风险，Q9）；footer 键帽风格（键亮说明灰）+ notice 占左侧 + 右侧回执/spinner 不变（Q10）；危险动作行 `⚠ ` 前缀（Q11）；sgrOf 扩展 **256 色分支仅供 banner 渐变**（安装器同款青→蓝→紫，`NO_COLOR` 既有降级不变，Q12）；版本号读 tui 自身 package.json（createRequire，cli banner 同款房屋模式，回退 `?`，Q13）；banner 显示条件 `width≥110 && height≥20`（Q14；实施修正见 Q6 注记：整幅 108 列）；chrome 禁 emoji（Q15）。
拒绝项（合并）：16 色近似渐变（视觉断层，既扩 sgrOf 何不一步到位）；全屏面板 spinner 叠加（v2）；⚠ 换自造字形（测宽风险）。

**Q16 收敛检查：还有没访问的分支吗？**
➡️ 自答：busy 时面板内 spinner（footer 已有，v2）；`exitAfterBusies` 死字段（无关，不动）；切根/换语言重载（既有 refresh effect 覆盖）；鼠标（spec 0009 非目标维持）。**无新分支，树收敛。**

**Q17 票据切分？**
➡️ 自答：01 导航与反馈 → 02 数据活化 → 03 品牌与 banner → 04 视觉打磨 → 05 验收接线（tracer-bullet，每票门禁全绿，`Blocked by` 链式）。

**Q18 验收新增断言？**
➡️ 自答：无头渲染断言——dashboard 按 right 切 guard；guard 首次进入产生 autoload effect 且视图非空；安装屏 Tab 换子页；100×30 总览含字标、40×12 不含；帮助含 `←→`；footer 无 `1-8 切屏` 旧文案；preview.txt 重生成；三门禁全绿；docs/usage.md §6 键位更新。

## Round 10 — Guard TUI 显示完整性与信息架构（2026-08-30，SPEC 0011）

> 起因：用户验收 0010 后两点不满——(1) 命令没有放在合适的位置（选择语言混在设置密钥区）；(2) 多行输出显示不完整（guard stats / guard recent）。排查发现"显示不完整"是两条独立丢失路径叠加，帮助页另有一处整体超屏。本轮为**自问自答**（用户授权代答）。ADR 结论：全部改动落在 ADR-0014 已定的纯函数渲染层与 runCli 动作层内，**无新 ADR**（与 Round 9 同款结论）。

**Q1 显示不完整的根因是什么？**
➡️ 自答：两条独立机制。(a) **横向**：输出面板 `fitToWidth` 静默截断（无省略号、无换行）——`guard recent` 定宽表约 89 列（时间+工具+结果+层级+命令），在 ~53 列面板里「层级」列整列不可见、结果列切半；回执行被注入的 `--config-root <绝对路径>` 顶爆；set show-key / examine status / guard status 的绝对路径、optimize list 长规则行、80 列终端下的日志屏同理。(b) **纵向**：回执贴底只显示最后一屏（viewport = height−5），而四个列表屏 `↑↓` 被动作光标占用、PgUp/PgDn/g/G 未绑定——面板滚动指示符（↑/┃/↓）是纯装饰。帮助页 46 行内容无条件输出且整屏不响应按键，24 行终端永远看不到后 25 行（三个命令组 + 尾行）。
拒绝项：只修其中一条（用户观感是"没显示完整"，两条都得修才算回应）。

**Q2 横向丢失：折行、横向滚动、加宽面板还是加省略号？**
➡️ 自答：**渲染期折行**（复用 `wrapToWidth`，状态面板/总览卡已是同款策略——同屏两套策略正是违和感来源）。在 render 路径折行保证 resize 自动重排：视图状态只存原始行 + offset，宽度变了下一次 render 自然重折。
拒绝项：横向滚动（双维滚动认知负担，终端惯例差）；加宽右栏（80 列窗口救不了，治标）；`truncateToWidth` 加省略号（仍是丢内容，只是告知丢了多少）。

**Q3 纵向滚动键怎么分配？↑↓ 已被动作光标占用。**
➡️ 自答：列表屏与帮助屏：`PgUp`/`PgDn` 翻页、`g`/`G` 首/尾滚**输出面板/帮助全文**，`↑↓` 保持动作光标——零冲突、vim 惯例；帮助屏无光标，同一套键滚全文；日志屏键位不变。offset 仍存 `views[screen]`；reduce 期用原始行数近似滚动，渲染期 clamp 到折行后总行数兜底（run-done 的 1e6 贴底语义不变）。
拒绝项：Tab 切面板焦点（0009 已拒绝的焦点模型，多一维状态）；Shift+↑↓（部分终端/复用器吞键）；g/G 给动作列表跳转（最多 9 项，不需要）。

**Q4 回执行被 `--config-root` 顶爆怎么修？**
➡️ 自答：回执记录**用户视角的 argv**（`run.argv`），注入的 `--config-root` 只存在于实际执行调用（`execRun` 内部）。当前根在顶栏 chip 已有，切根有 notice。footer（只取前 3 token）、日志屏、输出面板三个显示通道同时受益，单一修改点。
拒绝项：三个显示通道各自剔除（三处修不如源头修）；回执加 root 字段在日志屏标注（信息密度暂不需要，v2）。

**Q5 set 屏动作怎么归位？**
➡️ 自答：**小节标题分组**：密钥（查看 / 设置向导 / 清除）→ API 端点（地址 / 模型 / 重置）→ 偏好（**界面语言**、历史层）→ 维护（重载说明）。语言是偏好不是密钥配置——用户原话"选择语言放在了设置密钥的部分"。组标题为非选中行，光标自动跳过。
拒绝项：拆成两个屏（数字 1-8 已满，且 CLI 语义就是一个 `set` 组，拆屏制造 TUI 与 CLI 的映射噪音）；语言提升为全局快捷键（不可发现，header chip 已显示当前语言）；只重排不加标题（四类混排的根因是缺结构不是缺顺序）。

**Q6 帮助页布局？**
➡️ 自答：与输出面板同一机制：折行（命令表改全宽预算，不再卡 38% 右栏）+ 滚动（Q3 键位），46 行内容在 21 行视口完整可达。键位表同步新增滚动键。
拒绝项：压缩塞一屏（46→21 必然删内容，与本轮目标相反）；分页数字键（新增一层状态）；两栏瀑布（窄窗口下更糟）。

**Q7 安装预览面板与日志屏要不要特判？**
➡️ 自答：不要——同一折行机制直接覆盖（安装预览 diff 行、日志行在 80 列终端同样超宽）。零特例是组件级改动的验证标准。

**Q8 收敛检查：还有没访问的分支吗？**
➡️ 自答：footer 增加滚动键提示（宽度不足时 `footerBar` 既有截断优雅降级）；`exitAfterBusies` 死字段继续不动；core 零改动、cli 零改动；鼠标/主题/实时流维持 0009 非目标。**无新分支，树收敛。**

**Q9 票据切分？**
➡️ 自答：01 面板折行（三屏共用，纯渲染）→ 02 回执 argv 与滚动键 → 03 set 屏分组 → 04 帮助页重排 → 05 验收接线（tracer-bullet，每票门禁全绿，`Blocked by` 链式）。

**Q10 验收新增断言？**
➡️ 自答：无头断言——超宽行折行后输出面板包含行尾内容（如 `[cache]` 层级）；窄窗 `guard recent` 可 `g` 滚至顶看到首行；`❯` 回执行不含 `--config-root`；set 屏光标跳过组标题、四组顺序固定；80×24 帮助页 `g` 到顶后 `: <command>` 行可达；键位表含 PgUp/PgDn；preview.txt 重生成；docs/usage.md §6 同步；三门禁（typecheck / test / smoke）全绿。

**Q11（验收后追加）语言切换归位总览？**
➡️ 自答：是——用户验收 0011 后拍板「语言选择放在总览，不该在密钥页」。总览屏宿主卡列表**末行**加「界面语言」行（hint 显示 `zh ⇄ en`），光标移上 Enter/Space 切换；语义不变：仍经 `runCli` 执行 `set lang`（单一事实源），run-done 的 refresh 重载 roots 后界面语言按四层解析刷新。密钥屏偏好组只剩历史层；`l` 键保持全局切屏不可挪用，故不设专用快捷键（行 + Enter 即界面）。命令模式 `: set lang en` 不变。
拒绝项：`l` 快捷键（已被全局切屏占用）；语言做成 header chip 交互（不可发现、无鼠标）。

## Round 11 — 架构评审①：宿主运行时收敛 + qoder delete_file（2026-08-30，ADR-0016 / SPEC 0012 / SPEC 0013）

> 起因：improve-codebase-architecture 全仓扫描产出四个 deepening 候选（①hook 宿主共享运行时 ②裁决管线显式化 ③TUI 屏幕接口统一 ④宿主清单单事实源），用户拍板「都可以做」，按推荐序先收敛 ①。本轮为**用户逐题拍板**（非自答），两轮 frontier + 事实查证收敛。②—④排队后续 grill。HTML 报告落临时目录（architecture-review-20260830-*.html）。

**Q1 四份 hook 宿主拷贝收敛成什么形状？**
➡️ 用户拍板：新包 `@auto-guard/host-runtime`，`createHookHost(宿主描述符)` 唯一入口（hookMain/sessionMain/cliMain/emit）；描述符八字段纯数据 + 出口序列化器槽 + 可选目录扩展，不加第七个槽；opencode 经序列化器槽加入（`{status,reason}` 契约，plugin.ts 留守）；语言层以 zcode 版为基底、三宿主补齐双语（中文兜底保证默认输出逐字节不变）；宿主包保留薄门面、安装器 profile 零改动（用户侧安装难度零变化）；pi/dsh 仅复用 `buildGuardDeps`（放 host-runtime 单独导出，放 core 会模糊 ADR-0002 的「core 只出 decide + 类型」）；SPEC 0013 五票迁移，逐字节 pin 留作迁移检查点、04 票删。理由锚点：拷贝税是事实——语言层只落 3/6 宿主、conformance 把 qoder≡claude 钉死逐字节相同等于把重复制度化；四宿主真实差异实测仅各 ~30–60 行数据。
拒绝项：共享代码下沉 core（违反 ADR-0002）；连 pi/dsh 一起收编（进程内形态，seam 是 decide+注入件，为统一而统一）；安装器直指运行时、宿主包消失（已装用户全量迁移，零对价）。

**Q2 dsh/pi/zcode 形态迥异，一个运行时罩得住吗？**
➡️ 澄清：运行时只服务 **hook 形态**（stdin 读一次事件→裁决→emit→退出），四个 adapter 已坐在同一 seam 上；dsh/pi 是**进程内形态**，走 core 的 decide seam（ADR-0002 本就如此），只复用组合根 helper。不是一个运行时适配所有宿主，而是两形态两 seam——用户确认此边界。

**Q3 qoder delete_file 怎么守卫——合成普通 `rm` 还是 `rm -rf` 两段式？**
➡️ 用户选 A（普通 `rm "<path>"` 合成，单次 LLM 必审、永不静默放行、敏感路径降级、fail-closed）：两段式复核是 ADR-0012 为**递归目录删除**定制的纪律，单文件删除不匹配；B 使 qoder 比等价 bash `rm` 更严（制造跨宿主不一致，conformance 主张恰是等价）；`[删除理由]` 标记嵌命令字符串的协议在 path 字段上无处安放。递归能力未知数如实记录：证实可删目录则一行映射升级（`rm`→`rm -rf`，两段式自动生效）。要整体收紧删除纪律的正确杠杆是规则层（真 rm 与合成 rm 同时变严）。合成命令是本仓首个先例，独立成 SPEC 0012、先行合并，不混入 0013。
拒绝项：B（上述三条）；顺手混进运行时迁移（首个合成先例应独立测试独立评审）。

**Q4 README 承诺的 read/write 路径敏感审查是不是没做？**
➡️ 查证结论（事实，非决策）：**已全部实现**——core `decideFile` 对 write/edit/read 统一只过敏感路径门禁（命中 ask、内容永不送 LLM、纯同步），六宿主守卫工具表全含 read 类工具；唯一未覆盖是 qoder `delete_file`（README 两语均已披露的 v1 限制），正是 Q3 处理的对象。无需额外补做。

## Round 12 — 平台支持：macOS（2026-08-30，ADR-0017 / SPEC 0014）

> 起因：用户问「代码多是针对 Windows，mac 用户能用吗」。子代理逐文件审计结论：产品代码跨平台纪律成立——全部 win32 分支均有 POSIX 回退（detect/integration/guard-service/command 四处），配置根全走 `homedir()+join`，安装器模板为**安装期**字面路径替换（`${…}` 是占位不是 shell 依赖），加密纯 node:crypto（无 DPAPI/注册表），TUI 纯 ANSI，原生依赖 optional + 可降级。四个疏漏：smoke-zcode 只设 USERPROFILE、`engines >= 20` 低于实际（TS 直跑 + node:sqlite + 原生依赖 ≥22）、docs 无 mac 章节、README「≥20 / zero external deps」双声明不准。

**Q1 mac 支持到什么档位？**
➡️ 用户拍板开 spec：**Windows + macOS 双平台，v1 = 修复已知疏漏 + 机会性真机验证**（不买 mac CI、不承诺全宿主矩阵）；验证结论回写前对外标注「代码审计通过、真机验证中」。Linux 不承诺也不禁止。
拒绝项：Windows-only（跨平台纪律已在代码里成立，放弃无对价）；全面 mac CI 矩阵（宿主 mac 配置路径等事实未知，成本前置不理性）；静默 best-effort 不写文档（Node 20 用户必踩 engines 坑，文档必须诚实）。

**Q2 平台纪律的检查点是什么？**
➡️ 自答：win32 分支必有 POSIX 回退；路径只许 `homedir()+join`；安装器写值为安装期替换的字面路径；新增原生依赖必须 optional + 可降级——进 code-review 清单（ADR-0017 Consequences）。

**Q3 engines 下限写多少？**
➡️ 自答：候选 **22.18**（type stripping 默认开启与 `node:sqlite` 无标志取大；原生可选依赖 ≥22 已满足），由 SPEC 0014 工单 01 实测钉死（该版本真跑 init/ping/smoke），不拍脑袋写死在 ADR。

## Round 13 — 新宿主 Codex：ask 的宿主语义 + 补丁面（2026-08-30，ADR-0018 / SPEC 0015）

> 起因：用户要求本机接入 codex-cli 0.151.0。协议深查（官方 hooks 文档 + 二进制 strings）发现三处与既有 hook 宿主不同：PreToolUse 的 `"ask"` **解析但不支持**（hook 失败 + 调用继续 = fail-open）；文件编辑走 `apply_patch`、V4A 补丁文本塞 `tool_input.command`、单补丁多文件；集成通道有 config.toml TOML 与 hooks.json JSON 两条（双层会合并、同层双定义告警）。zcode 安装在先（用户已装），按 new-host 指南先测活再接入。

**Q1 ask 怎么落地？**
➡️ **绝不发 `"ask"`**：codex 会弃用该裁决并放行调用，比不装守卫还糟。能力声明 `headlessFallback: 'deny'`（dsh 先例），翻译放运行时**默认 wire 工厂**——描述符保持纯数据（ADR-0016 纪律），`'host'` 宿主行为逐字节不变；deny 理由附双语提示（为何没弹确认 + 出路：手动执行 / userConfirmed）。拒绝项：发 ask 赌宿主版本行为（fail-open，违反 fail-closed 纪律）；codex 包内私改 wire（行为函数进描述符包，ADR-0016 接缝就歪了——翻译由能力值驱动才是数据）。
**Q2 apply_patch 多文件怎么过敏感路径门？**
➡️ `ToolMapping.patchCommand` 纯数据槽 + `GuardRequest.paths` 可选多路径，core `decideFile` **遍历全路径**——文件工具唯一的守卫就是敏感路径门，只查首路径等于给补丁留后门。补丁文本缺失/零头部 → unreviewable（fail-closed）。内容纪律不变：decideFile 从不读内容。拒绝项：整个补丁当 bash 命令跑 shell 管线（补丁正文含 `;`/换行，复合拆分产出垃圾子命令）；把解析写进 codex 包（下一个补丁宿主得再抄一遍）。
**Q3 集成通道选哪个？allow 要不要短路宿主审批？PermissionRequest 要不要接？**
➡️ **独立 `~/.codex/hooks.json`**（纯 array-append，ADR-0008 门槛内零安装器改动），不碰 TOML 内联层——避免合并告警，复用既有写入器。**allow = 静默**（与 zcode/claude 同位：守卫纯加法，不代替宿主审批；full-access 模式下 deny 是唯一安全网）。**PermissionRequest 不接（v1）**：PreToolUse deny 已覆盖全量访问模式，审批层短路是独立特性，值得独立 spec。信任门（`/hooks` 内容哈希制，未信任静默跳过）如实写进 postInstall 警示——「看似开启实则没跑」比失效更危险。桌面 App 与 CLI 共享 `~/.codex` 与同一 hook 运行时（已核对内置二进制），同一集成覆盖；App 内信任 UI 未实机验证，文档如实标注。

## Round 14 — zcode ask 逃生舱：重开 Q11 的窄口径（2026-08-31，ADR-0019 / SPEC 0017）

> 起因：用户实测反馈——zcode 宿主对守卫 ask 只渲染三按钮（同意 / 本会话都同意 / 拒绝），没有「本会话都拒绝」，也没有附理由说明需求的输入框。Q11 当时不补四态的前提是「宿主原生弹窗够用」，实测不成立，但弹窗本身仍不可扩展（严格 zod schema + 无 TTY 子进程）。

**Q1 弹窗内能不能加第四个按钮 / 文本框？**
➡️ 不能，方案不存在：出线协议只有 `permissionDecision` 三值 + reason 文本，hook 是无 TTY 子进程（`hasUI: false`）。可控面只有 reason 文案、会话缓存、守卫自有 CLI/TUI。拒绝项：往 stdout 塞未文档化字段赌宿主 schema（`wire.ts` 已核实会被整体丢弃）；hook 里画 TUI（无 TTY，且污染宿主终端）。
**Q2 「本会话都拒绝」怎么落地？**
➡️ ask 出线时旁路落盘 pending ask（键 = `rememberAsk` 写入键，同键 upsert 防宿主放行后重复污染），CLI `guard ask allow/deny [--reason]` 复用 `rememberAsk` 写会话缓存（`expiresAt = MAX_SAFE_INTEGER`，随会话 24h 剪枝，「本会话」保真）；deny 命中时用户 reason 进模型上下文。拒绝项：重复 ask 自动升级 deny（守卫看不见弹窗结果，无法区分「拒绝过」与「同意过一次」，误杀合法 once 流）；写 rules.json（跨会话语义 + 用户所有物，违背 ADR-0008/0013 显式性）；ask 整体改 deny（丢一键同意，净倒退）。
**Q3 「附理由说明需求」怎么闭环？**
➡️ 弹窗内永远不可能有输入框——真话是：对话本身就是输入框。守卫能做的是把闭环铺通：ask reason 文末提示出路（仅 native 宿主）；deny-session 的 reason 在后续命中时作为 `permissionDecisionReason` 进模型上下文，模型按理由调整而不是原样重试。补充（2026-08-31 查证后修订）：ZCode 官方 hook 文档核实 `additionalContext` 注入对话、可与 PreToolUse permission decision 共存——ask 出线时预注射模型指引（拒绝后按理由调整不重试 / 本会话拒绝可走 `guard ask deny --reason`），把它从「未核实收益不实」升级为决策 4（ADR-0019）；它仍是守卫→模型通道，替代不了用户输入。拒绝项：把它当输入框用（方向反了，用户无法借此打字）。
**Q4 Q11 算不算被推翻？**
➡️ 窄口径重开：四态记忆给 zcode 补上（弹窗外的守卫自有通道），但「ask 委托宿主原生弹窗」的出线方式不变、能力声明不变——Q11 反对的「为统一而统一改弹窗内体验」仍然成立。pi/codex 行为零变化（落盘与文案门控 `askStyle === 'native'`）。

## Round 15 — 架构评审②：core 引擎内聚——段裁决内缝 / 调参切片 / 删除复核模块（2026-09-25，ADR-0021 / SPEC 0019）

> 起因：improve-codebase-architecture 第二次全仓扫描（HTML 报告落临时目录 architecture-review-20260925-1011.html）产出 8 个 deepening 候选，用户拍板「不改变 auto-guard 的判断、不怎么改变使用即可全做；自问自答（授权代答）；只落 ADR/CONTEXT/spec 文档，不实施」。本轮至 Round 17 为自问自答，按报告顺序 grilling（候补 1 段裁决内缝、2 GuardConfig 收窄、3 双 CLI 合一、4 守卫面目录、5 DSH 收编、6 删除复核模块、7 宿主策略下沉、8 门面瘦身）。根约束（用户拍板，凌驾全部后续答案）：**纯结构重构**——裁决结果、缓存行为、出线协议字节、prompt 字节、持久化 schema、CLI 语法全部不变；拷贝间已漂移的语义点**显式保留**，本次不做任何裁决。

**Q0 行为不变的验证标准是什么？**
➡️ 自答：四条门禁——(a) 既有测试断言一条不改（只许改 import 路径与纯搬家导致的构造调用）；(b) prompt 与 wire 出线保持逐字节（既有 pin 测试继续钉）；(c) stats 计数口径与缓存回写时机以既有断言钉死；(d) conformance 跨宿主等价矩阵全绿。新增测试只加不断。任何「顺手修正语义」的冲动都转为显式记录的已知不一致，留给未来 spec。

**Q1 段裁决内缝的形状？**
➡️ 自答：私有 `decideSegment(request, segment, ctx)` → 段结论（Decision + 命中详情 + 回写副作用收口）；decideShell / decidePipeline / decideCompound 退为围绕它的薄组合策略。**内缝（internal seam），不进公共 barrel**——GuardService 对外 interface 一字不变。三份拷贝逐块做等价性审计：逐字相同块（缓存回写三连 if、首过 hard-deny 块）直接合一；同义异形块合一；语义真分歧块（见 Q2）参数化保留并注明。
拒绝项：把 decideSegment 升为公开导出（外缝会诱惑宿主绕过 decide() 直接调段评估，出线协议失控）；先设计「可配置管线」（没有第二个 adapter，假缝）。

**Q2 管道谓词分歧怎么办——统一到哪端都会改判断？**
➡️ 自答：事实核verified——shell 侧 bypass 检查用 `containsShellOperators`（`/ [<>|]/`，含 `|`），templateCacheDecision/historyDecision 内联 `/[<>]/`（不含 `|`），history.ts 对审计行是第三种拼法（`includes('$(')||includes('\`')||/[<>]/`）。今天带管道的命令**可以**命中模板缓存/历史层，这是活语义而非笔误。决策：抽唯一谓词 `bypassesDeterministicTrust(command, {pipes})` 落 command.ts（紧邻它组合的两个原语），各调用点**保留当前选择**（shell 侧 pipes:true、模板/历史侧 pipes:false、history 行侧维持现状拼法）；三处口径差异记录为已知不一致清单，独立裁决留给未来 spec。本次零行为变化。
拒绝项：统一到严格端（管道命中即禁模板/历史层缓存——今天会放行的命令改走 LLM，改判断）；统一到宽松端（反向同罪）；「反正没人依赖」式猜测（无证据不改）。

**Q3 pending-deny 优先序的三个落点？**
➡️ 自答：`consultMemories(request, command)` 收拢「会话 deny → pending deny → 持久 allow」优先序为单一函数——今天它靠 cacheHit 内**语句位置**（会话读与持久读之间）+ llmDecision 的 guardMemory 复查 + compound 的第三个 helper 三处手工维持。优先序本身不变，只是获得唯一所有者与唯一测试面；`guardMemory=false` 逃生舱随缝内化。
拒绝项：改优先序哪怕「更合理」（根约束）；把 pending-deny 提升为独立公开模块（域概念是 Guard Memory 的实现细节，CONTEXT 已有词条，不加新词）。

**Q4 stats 手织 11 处递增怎么办？**
➡️ 自答：`record(decision)` 单点记录——source 已在每条 Decision 上，cache 命中从 source 推导；「计数口径与今天逐点相同」作为验收断言（既有 stats 断言原样保留）。GuardStats 类型、createStats/resetStats/recordRuleHit 四处同步的税随之消失。ruleHits 的 6-of-14 枚举改为从 DecisionSource 全集推导——类型形状不变（键集合相同），只是不再手工维护两份清单。

**Q5 调参切片的边界画在哪？**
➡️ 自答：新类型 `GuardTuning`（暂名，SPEC 定稿）= GuardService 实际消费的 ~10 键（lang、lowRiskTtlDays、mediumRiskTtlDays、alwaysReviewCacheTtlMinutes、onTimeout、fileTrackerDefault、historyEnabled、examineEnabled、historyMinTotal、historyMinLlm）。GuardService 构造签名从 GuardConfig 收窄为切片；**全量 GuardConfig 留在宿主配置层**（持久化 schema 零变化），切片在单点组合根（host-runtime/guard-deps.ts）发生。纯数据，无方法。
拒绝项：拆 GuardConfig 落盘子 schema（改持久化格式）；切片带行为（那是 service 的事）；langs 解析逻辑随切片搬家（langOf 留在 core 语言层，切片只带结果值）。

**Q6 9 个 spec 文件里 45 行 makeConfig 模板怎么办？**
➡️ 自答：随切片收敛为个位数键的 makeTuning()；既有行为断言不动。顺手治好 guard-service.spec:119 伸进私有 llmReviewer 的钩子——setup() 返回它创建的依赖引用（测试基建修复，非行为变化）。

**Q7 删除复核模块的边界与 session key 语法归属？**
➡️ 自答：新文件 `core/src/directory-delete.ts`，surface = prepareRetry / matchPending / targetsOf + 既有标记协议导出（extractDeletionMarker 等经 core index 原**路径** re-export，7 个调用方零改动）；guard-service.ts 1260 → ~820 行纯管线。session key 语法（`session|workspace|command`）成对归属 cache.ts——build 与 split 同主，directory-delete 消费不自制（今天 splitSessionKey 与 cache.ts buildSessionKey 分持正是要消灭的）。纯搬家：私有函数转模块内导出，逻辑零改动；Pi 事件格式解析（messageText）一并入该文件（它是删除理由的数据源，不是管线逻辑）。
拒绝项：key 语法第三处安家；改动标记协议字节（`[删除理由]` 是域协议，ADR-0012/0013 语境）；为新模块设公开子入口（走 barrel re-export 即可）。

**Q8 搬家与抽缝谁先？**
➡️ 自答：搬家（Q7）先——纯移动零语义风险，且把 guard-service 缩到 ~820 行后，段缝的 diff 才可审。施工序 6 → 1 → 2；grilling 序仍按报告 1 → 2 → …（两序解耦，记录在案）。

**Q9 收敛检查：还有没访问的分支？**
➡️ 自答：decideSegment 不为 file 工具留位（decideFile 本就独立且薄，敏感路径门无段概念）；`sessionIdOf` 死透传删除（全仓零调用者，deletion test 平凡通过）；`guardReason` 与 decideShell 的确定性前缀共享——实施期做等价抽取但两者返回值逐字节不变；testTimeout 抖动与本轮无关（机器负载，非代码问题）。无新分支，树收敛。

## Round 16 — 架构评审③：管理 CLI 单引擎 + 守卫面目录 + DSH 收编（2026-09-25，ADR-0022/0023/0024 / SPEC 0020/0021/0022）

**Q1 两 CLI 合一后，能力面怎么保住「不改使用」？**
➡️ 自答：CliParts 增**能力声明**（命令组开关）：cli 驱动声明「无 ask 组、含聚合状态」，runtime 驱动声明「含 ask 组与 set-key 向导、无聚合状态」——今天每个入口能做什么，明天逐字节相同。createCliMain 深化为唯一 dispatch/渲染/退出码/usage 引擎；两个真实变量点（根解析模式：自动探测 vs 描述符钉根；输出 sink）+ 能力声明 = adapter 参数。conformance 先钉两 CLI 当前行为快照，再动工。
拒绝项：借合并顺手把 ask 组带给 cli（扩大命令面 = 改使用，无人要求）；两个 CLI 强行对齐向导/聚合差异（同罪）。

**Q2 usage 文案的程序名前缀（`auto-guard` vs `node dist/cli.js`）？**
➡️ 自答：程序名作 CliParts 字段，字符串参数化；usage 键本身随 Q4 进共享目录。

**Q3 packages/cli 剩什么？**
➡️ 自答：安装器 + 根探测 + 聚合视图 + 驱动壳。TUI 的 runCli(argv) interface 不变（内部换引擎），回执语义不变；安装器 profile 与入口路径零改动（ADR-0008 可逆性不碰）。

**Q4 守卫面目录的键怎么选正典——三种漂移措辞统一会改用户可见文案？**
➡️ 自答：三步审计——(a) 同键逐字相同（pingOk、examine*、showKey* 多数）→ 直接搬 core；(b) 同义异形（deleteFail 双标题 ×3 措辞、rollbackDone ×3、analyzeDone ×3）→ 选语义最准者统一：微调文案不改变判断与操作方式，属用户授权的「不怎么改使用」范围，且键级 diff 清单进 SPEC 验收可审计；(c) 措辞承载宿主上下文的 → catalogOverride 数据槽保留（ADR-0016 已建机制）。共享目录落 core（defineCatalog 旁）；host-runtime/pi/dsh/cli 目录瘦身为宿主 chrome。
拒绝项：三份措辞全保留靠 override（重复制度化，漂移照旧——正是要治的病）；动 defineCatalog 类型对齐机制（ADR-0011 机制不动，动的只是键的家）；顺带统一 zh/en 双语以外的格式问题（不存在）。

**Q5 CONTEXT「消息目录」词条「文案归各包所有」要不要修订？**
➡️ 自答：要——这是候补 4 唯一真正推翻的旧表述，修订为「守卫面文案归 core 共享目录，宿主 chrome 归各包；跨包只共享取词函数不变」。ADR-0011 的四层解析与每包目录机制不受影响（目录还在，只是守卫面键搬家）。

**Q6 评审 seam 上移的形状——directChatReview 放哪、边界多大？**
➡️ 自答：core 导出单函数 `directChatReview(tuning, lang, request, apiKey) → ReviewOutcome`：prompt 组装、单发调用、400→fallbackModel 重试梯、超时预算、combineSignals 兜底全部内化。DeepSeekReviewer.review 退为薄包装（LlmReviewer 外缝不变——两 adapter 仍坐同一 seam）；DshLlmReviewer 只留 ctx.llm.stream 路由 + hasDirectEndpoint 分支委托 core。dsh 缺的 combineSignals 兜底顺手补齐（node≥22 均有 AbortSignal.any，正常环境行为不变，纯健壮性对齐）。HttpError/ping/用户消息组装三份拷贝随之消亡。
拒绝项：把 dsh 流式路由搬进 core（ctx.llm 是宿主注入件，进 core 违反 ADR-0002）；directChatReview 吞掉 LlmReviewer 接口（外缝有两个真 adapter，保留）。

**Q7 dsh 默认值五处静默分歧怎么办？**
➡️ 自答：声明式增量：`DSH_DEFAULTS = { ...defaultGuardConfig(root), /* 评审走 ctx.llm 注入件，不需要直连地址 */ apiBase: '', /* dsh 设置页等待窗更长 */ timeoutMs: 15000, ... }` 逐行注明故意原因；三份键清单（CONFIG_KEYS / USER_CONFIG_KEYS / GUARD_SETTINGS_SCHEMA.keys）从单一 FieldSpec[] 派生，新增 GuardConfig 字段不再靠手工三处镜像。**现值零变化**——分歧从考古现场变注释。
拒绝项：借机把 dsh 默认值「修正」向 core 看齐（改现网行为，违反根约束）；FieldSpec[] 引入校验框架（YAGNI，纯派生清单）。

**Q8 dsh 私有分析/回滚操作回归 core？**
➡️ 自答：AnalyzeOptions 扩展 `full`（dsh remote「立即分析」传 true，**保持今天永远全量的行为**）+ 可选 gate（auditPassword 门以配置标志或回调注入）；删私有 runLearnedAnalysis 与私有 rollback 包装（core rollbackLearnedRules 已存在）。pi/cli/zcode 既有调用零改动。
拒绝项：顺手把 dsh 分析改回窗口模式（改行为；窗口 vs 全量的取舍未来再议）。

**Q9 收敛检查？**
➡️ 自答：cli 的 set-key TTY 拒绝 stub vs runtime 向导——能力声明各自保留不强行对齐；tui/i18n 与 installer/i18n 是包内 chrome，合法不动；两 CLI 的 exit code 表合并后逐值相同（0/1/2 语义既有测试钉）。无新分支，树收敛。

## Round 17 — 架构评审④：宿主策略下沉 + 门面瘦身 + 全局收敛（2026-09-25，ADR-0025 / SPEC 0022）

**Q1 三个策略函数放 core 还是 host-runtime？**
➡️ 自答：core——`translateDecision(decision, capabilities)`（返回 action/reason/needsHumanVeto/vetoTitleKey）、`resolveNotify(decision, config, capabilities)`（返回 route/text 或 undefined）、`recordToolCallAudit(store, ...)`（source 参数化吸收 user_bash 变体）。三者只依赖 core 自有类型（HostCapabilities/AuditStore/classifyCommand）；host-runtime/pi/dsh 改调用，各自只剩 sink（wire / ui.notify / session inject）。审计记录 schema 逐字段不变。
拒绝项：放 host-runtime（pi/dsh 不经 host-runtime，放那里等于给第二份拷贝安家）；translateDecision 返回文案而非键名（文案的家在目录，见 Round 16 Q4）。

**Q2 与守卫面目录的联动顺序？**
➡️ 自答：translateDecision 返回 vetoTitle **键名**，查词走共享守卫面目录——键的家随 SPEC 0021（候补 4），策略的家随本票（候补 7）；4 先 7 后施工更顺，但互不阻塞（7 可先带旧键名落地）。

**Q3 门面瘦身到什么程度？**
➡️ 自答：createHookHost(descriptor) 增导出绑定好的 bootstrap/extraction/render 对象（或平级 bindHost(descriptor) helper）；五宿主（zcode/claude/qoder/codex/opencode）的 bootstrap/config/hook-output/*-adapter 仪式文件退成单行 re-export 或删除；tests/conformance import 改指 bindHost。安装器 profile 与宿主入口路径零变化（ADR-0008 可逆性）；opencode 的 plugin.ts/payload builders 是真宿主耦合，保留。
拒绝项：删宿主包本身（安装器与已装用户引用其入口）；为此设新 ADR（ADR-0016「宿主包保留薄门面」的延伸，票内记录即可）。

**Q4 候补 8 的优先级？**
➡️ 自答：Speculative 维持——收益依赖第 8 宿主是否到来；排全部候选最末，工单标低优先，允许无限期搁置。

**Q5 施工总序与 spec 切分？**
➡️ 自答：四个 spec 覆盖八候选——**SPEC 0019 core 引擎内聚**（施工序：6 搬家 → 1 段缝 → 2 切片；ADR-0021）；**SPEC 0020 管理 CLI 单引擎**（3；ADR-0022）；**SPEC 0021 守卫面共享目录**（4；ADR-0023，施工在 0020 后——usage 程序名参数化先就位）；**SPEC 0022 宿主层收拢**（5 DSH 收编 → 7 策略下沉 → 8 门面；ADR-0024 + ADR-0025，8 无 ADR）。切分理由：0019 同一文件族（guard-service.ts）不可并行；3 与 4 在 cli/host-runtime/messages 文件族重叠；5/7/8 全在宿主层且 5 的翻译拷贝由 7 承接、8 收尾。四 spec 间依赖：0019 与 0020/0021/0022 完全独立可并行；0021 依赖 0020 的参数化；0022 的 7 依赖 0021 的键搬家更顺（软依赖）。
拒绝项：一个伞 spec（八候选跨四个文件族，票据图退化成全连通）；每候选一 spec 共八个（3/4 与 5/7/8 各自强耦合，切开制造假边界）。

**Q6 全局验收门禁？**
➡️ 自答：每票 tracer-bullet——typecheck / test / smoke 三门禁 + conformance 全绿；既有断言只许改 import 与构造调用；SPEC 0021 验收附**键级文案 diff 清单**（用户可见文本每一处变化可审计）；prompt/wire 字节 pin 维持；SPEC 0019 验收附 stats 口径与缓存回写时机的等价断言清单。全部完成后重跑 improve-codebase-architecture 对照——漂移点应只剩「已知不一致」清单显式记录的管道谓词一处。

**Q7 收敛检查：还有没访问的分支？**
➡️ 自答：conformance 包自身结构（未在候选内，不动）；audit-sqlcipher 未触及；learned-rules 刚交付的锚定/合并（今日两提交）不动；guardReason 同步守卫的等价抽取已在 Round 15 Q9 记录。无新分支，树收敛。
