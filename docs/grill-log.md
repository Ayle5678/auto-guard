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
