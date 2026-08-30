# 安装器故障排查（SPEC 0002）

## 检测不到宿主

- 检测是纯启发式：`~/.dsh`、`~/.pi` 目录（加可执行文件探测）、`~/.zcode/cli/config.json`、`~/.claude/settings.json`、`~/.config/opencode/opencode.json`、`~/.qoder/settings.json`。确认对应目录/文件存在；`dsh` 在 `PATH` 上（claude/opencode/qoder 的可执行探测只是加分项，文件证据单独即可命中）。
- 目录确实存在但 `auto-guard list` 显示"否"：检查 `HOME` 是否指向预期位置（可用 `--home <path>` 显式指定再试）。
- 宿主装了但目录特征不同：不要硬猜，先跑 `auto-guard list` 看证据行；确认无误后仍可在交互模式手动勾选并确认路径。
- 安装器**不安装宿主本身**：宿主未安装时 `init --host …` 会直接拒绝（退出码 2），先装宿主。

## hooks 未生效（ZCode / Claude Code / Qoder）

- ZCode、Claude Code 与 Qoder hooks **没有热重载**：写入成功后必须**新开宿主会话**才加载。init 的完成摘要会提示这一点。
- 新会话仍未生效：`auto-guard list` 看对应宿主是否"已接入"；再确认写入的 `dist/hook-cli.js` 路径存在（缺失时 init 会拒绝并提示先构建（仓库内 `pnpm build`））。
- ZCode 对配置文件 hooks 结构有硬校验：只认 `hooks.enabled` 与 `hooks.events.<事件>`，其它键（如 v0.3.0 误写的平铺 `hooks.PreToolUse`）会导致**整个 config.json 被拒绝加载**，ZCode 日志报 `hooks: Unrecognized keys`。升级到修复版后跑一次 `auto-guard init --host zcode --yes`，会自动迁到 `hooks.events.*` 并清理失效键。
- 验证守卫是否在工作：新会话里跑一条会被守卫看到的命令，或 `auto-guard guard status`（需 `--config-root` 指到对应配置根或让 CLI 自动探测）。

## Claude Code：hooks 被 cc-switch / clawd 抹掉

- 症状：守卫此前正常，切换模型/工具后突然**全静默**（任何命令都不弹确认）。
- 原因：cc-switch / clawd 等切换器会整体覆写 `~/.claude/settings.json`，hooks 块随之丢失（历史上有 `settings.json.orig/.bak` 清理备份为证）。
- 自检：`auto-guard list`（claude 行变"未接入"）或 `node <host-claude>/dist/cli.js guard ping`。
- 恢复：`auto-guard init --host claude --yes` 重新写入（幂等，用户其余配置不动）。

## OpenCode：启动器损坏 / 插件未加载

- `opencode --version` 报 "postinstall script was not run"：npm 安装时 postinstall 未执行。修复：`node <npm 全局目录>/node_modules/opencode-ai/postinstall.mjs`（机器运维项，一次即可）。
- 插件未加载：确认 `~/.config/opencode/opencode.json` 的 `plugin` 数组含 `<…>/host-opencode/dist` 条目且该目录存在（缺失时先 `pnpm build`）；`opencode` 须**重启**才加载插件。
- 守卫 ask 全部落 TUI、allow 无感、deny 被拒即工作正常。若连 TUI ask 都没有：检查 permission 的 `bash`/`edit`/`read` 是否含首位 `"*": "ask"`（`auto-guard list` 的 opencode 行可查接入状态）。

## Qoder：hooks 不生效 / 版本与入口边界

- 只支持**国际版 Qoder IDE**（用户级配置 `~/.qoder/settings.json`）。CN 版（`~/.qoder-cn/`）与 Qoder CLI 入口不适配——CN 版用户找不到写入痕迹是预期行为，不是故障。
- hooks 无热重载：装完必须新开 Qoder 会话。新会话仍未生效时：`auto-guard list` 看 qoder 行是否"已接入"；确认 `~/.qoder/settings.json` 的 `hooks.PreToolUse` 还在且条目指向存在的 `dist/hook-cli.js`；再重跑 `auto-guard init --host qoder --yes`。
- Qoder 的 hooks 配置在 IDE / CLI 入口间共享：CLI 若支持同名事件也会执行本守卫——接受的副作用，不另做适配。
- `delete_file` 工具按单文件 bash `rm "<路径>"` 合成守卫（与真实 bash `rm` 同流）；递归目录删除仍走 bash `rm -rf` 的两段式复核。

## 权限被宿主配置默认禁用

- 守卫要写宿主配置文件（pi 的 `settings.json`、zcode 的 `config.json`、claude 的 `settings.json`、opencode 的 `opencode.json`、qoder 的 `settings.json`）。若宿主处于"只读/安全模式"或配置文件被锁定（宿主正在运行且缓存了配置），写入会失败或被宿主下次启动覆盖。
- 做法：关闭宿主后再 init；写入前安装器会展示 diff 并强制备份（`*.auto-guard.bak`），失败时 `remove` 可还原。
- DSH 的接入走原生渠道 `dsh plugin add/remove`：若命令报权限错误，检查 dsh 自身的插件策略；`auto-guard list` 中 DSH 接入状态显示"未知"即说明查询命令失败。

## 其他

- 重复 init 安全：已接入条目自动跳过，已有备份不会被二次覆盖。
- 卸载后 `~/.<host>/auto-guard/`（规则、缓存、审计）**保留**；彻底清除需手动删除对应目录。
- 退出码：0 成功；2 = 有宿主失败 / 未检测到宿主 / 未知 `--host` 值（报错会列出可用值）。
