# 0004 — 全产品双语化（引擎 / 管理 CLI / 宿主适配层）

Status: done（2026-08-30 核对收口：实现早已落地，工单状态补记）

Design: ADR-0010（安装器双语，已完成）、ADR-0011（语言设置四层解析 + 每包消息目录）
Glossary: 语言设置 / 机器默认语言 / 消息目录 / 裁决理由 / 删除理由标记（见 CONTEXT.md）

## Problem Statement

安装器已支持中英双语（0003），但安装之后的一切仍是中文：管理 CLI 的输出、引擎的裁决提示、宿主会话内的询问与拦截提示、审计理由。英语用户装完第一分钟就回到中文世界；审计库里存的理由语言也不可控。用户希望「安装时选一次语言，之后一直用，随时可单独改」。

## Solution

把语言设置做成一等配置：四层解析（env > 每宿主 config.lang > 机器默认 > 中文兜底），安装器的选择落盘为机器默认并传导到尚未播种的每个宿主；`set lang` 随时单宿主改语言。全部用户可见文案迁移到每包一份的中英消息目录；LLM 裁决理由语言跟随设置；询问四选项改为值匹配以解除「文案即匹配键」的耦合；`[删除理由]` 协议标记保持原样。中文兜底保证存量行为与测试零变化。

## User Stories

1. As an English-speaking developer, I want to pick English during `init` and never see Chinese again in any auto-guard output, so that the tool feels native on my machine.
2. As an English-speaking developer, I want host-session prompts (confirm dialogs, ask options, deny reasons) in English, so that I can act on them without translating.
3. As an English-speaking developer, I want my audit records' reasons in English, so that reviewing my own history is effortless.
4. As a Chinese user, I want zero behavior change when I never touch language settings, so that upgrading carries no surprise.
5. As a Chinese user, I want `set lang en` scoped to one host's config root, so that switching one host doesn't affect the others.
6. As a multi-host user, I want hosts I never explicitly configured to follow the language I chose at install time, so that the choice propagates machine-wide without per-host setup.
7. As a script/CI author, I want `AUTO_GUARD_LANG=en` to override everything for one invocation, so that pipelines get deterministic output regardless of machine state.
8. As a user who chose the wrong language at install, I want `auto-guard set lang <zh|en>` to switch immediately without reinstalling, so that fixing the choice costs one command.
9. As a user re-running `init`, I want the installer to remember my language and not re-ask, so that repeated runs stay friction-free.
10. As a user re-running `init --lang en`, I want the machine default updated, so that changing the machine-level language doesn't require reinstalling.
11. As a user running `remove`, I want my language preference kept, so that reinstalling later restores the same experience (mirroring "data roots are kept").
12. As a debugging user, I want `guard status` to show the effective language, so that I can tell why output is in a given language.
13. As a user who just ran `set lang en`, I want the confirmation in English, so that I have immediate proof the setting took effect.
14. As a user facing the four-way ask dialog, I want the options in my language while my choice is remembered exactly as before, so that localization changes no semantics.
15. As a ZCode user, I want the hook status spinners in my language, so that even the transient UI matches (new installs; existing installs untouched until re-init).
16. As a maintainer, I want catalogs type-checked for key parity between languages, so that adding a string in one language cannot silently miss the other.
17. As a maintainer, I want the `[删除理由]` marker to remain a stable protocol token, so that existing user habits and audit records keep parsing.
18. As a maintainer, I want every existing Chinese-output test to pass unchanged, so that the zh fallback contract is enforced by the suite itself.

## Implementation Decisions

- **四层语言解析**：`AUTO_GUARD_LANG` > 每宿主 `GuardConfig.lang`（新增可选字段，缺省未设）> 机器默认 `~/.auto-guard/config.json`（`{"lang": "en"}`，可扩展）> `zh`。解析器为 core 纯函数，文件读取可注入。
- **`set lang <zh|en>`**：加入既有 `set` 命令组，写当前配置根的 `lang`；回执用新语言输出。`guard status` 增加一行当前生效语言。
- **安装器接线**：交互提问与 `--lang` 都写入机器默认（提问后立即写，不等安装结果）；后续运行读到机器默认即不再提问；`remove` 不清除。
- **目录架构**：取词 helper（`message`/`Lang`/`normalizeLang`）提升到 core（纯函数+数据，符合 ADR-0002）；core、host-pi、host-zcode、host-dsh 各持一份目录，键一致由类型系统强制；cli 安装器目录保持不动、helper 改为复用 core。
- **文案迁移范围**（按包全量迁移，非穷举）：core 的状态/历史/优化/通知/来源标签消息；cli shell 的管理命令文案；host-pi 的会话 UI（确认、询问、拒绝原因输入、/guard 命令注册与统计、状态条）；host-zcode 的自带管理 CLI（guard/set/examine/optimize 的用法行与全部输出，含审计统计、set-key 警告、autoAnalyze 保护提示）、hook 拦截与 fail-closed 消息、hook 输出渲染；host-dsh 的通知策略与消息。
- **LLM 理由语言**：审查提示词按 config.lang 追加语言指令；config 稳定故 prompt-cache 命中不变；历史记录不翻译。
- **ask-memory 值匹配**：四选项结构化为 `{value, zh, en}`；`resolveAskMemory` 只认 value；Pi 用「两语言 label → value」反查表承接 `ui.select` 返回的标签字符串。
- **profile statusMessage**：安装时按安装语言从目录取文案生成模板；marker 幂等保证已装用户不被重写。
- **`[删除理由]`**：保持中文原样，解析不加别名。
- **零迁移**：存量配置无 `lang` 字段视为未设，自然落到机器默认/兜底层。

## Testing Decisions

- 好测试只测外部行为：给定语言与输入，断言可见输出与落盘结果；不断言目录内部结构。
- **最高缝是既有 CLI 缝**：`runCli(argv, deps)` + 可注入依赖（env、文件读取注入为临时目录路径），覆盖 `set lang`、`guard status` 语言行、安装器提问持久化、四层解析矩阵——这是本特性主要新增测试所在，不新造缝。
- 既有纯函数缝沿用：core 消息函数以 `config.lang` 参数化后按现有单测模式加 en 断言；`resolveAskMemory` 值矩阵；审查提示词构造器用 fake reviewer 捕获 system prompt 断言语言指令。
- 宿主缝沿用既有模式：host-zcode hook-cli 注入 stdin/裁决；host-pi 用 fake `ctx.ui` 捕获标签文案。
- **zh 兜底契约**：全部存量中文断言测试不改一字必须继续通过；每个包另加至少一条英文金路径断言。

## Out of Scope

- 管理命令输出以外的第三种语言及运行时热切换（改语言在下次进程启动生效即可，hook 本就每次启动重读配置）。
- 本地化 `[删除理由]` 标记或为其加英文别名。
- 已存在的审计记录、决策历史、会话缓存条目的语言。
- 安装器把语言播种进宿主配置根（违反 SPEC 0002，ADR-0011 已否决）。
- LLM 提示词其余部分的翻译（系统提示词已是英文）。

## Further Notes

- 实施顺序建议：core + CLI 先行（同一口径一次完成），再三个宿主适配层，最后安装器接线与文档；每步全仓测试与 typecheck 保持绿。
- 机器默认文件属 auto-guard 自身命名空间（文档已有 `~/.auto-guard/bin/` 先例），不违反 SPEC 0002「不创建宿主配置根」。
- `~/.auto-guard/config.json` 出现未知字段时忽略，只读 `lang`。
