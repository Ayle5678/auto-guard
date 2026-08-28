# 安装器故障排查（SPEC 0002）

## 检测不到宿主

- 检测是纯启发式：`~/.dsh`、`~/.pi` 目录（加可执行文件探测）与 `~/.zcode/cli/config.json`。确认对应目录存在；`dsh`/`pi` 需在 `PATH` 上。
- 目录确实存在但 `auto-guard list` 显示"否"：检查 `HOME` 是否指向预期位置（可用 `--home <path>` 显式指定再试）。
- 宿主装了但目录特征不同：不要硬猜，先跑 `auto-guard list` 看证据行；确认无误后仍可在交互模式手动勾选并确认路径。
- 安装器**不安装宿主本身**：宿主未安装时 `init --host …` 会直接拒绝（退出码 2），先装宿主。

## hooks 未生效（ZCode）

- ZCode hooks **没有热重载**：写入成功后必须**新开 ZCode 会话**才加载。init 的完成摘要会提示这一点。
- 新会话仍未生效：`auto-guard list` 看 ZCode 是否"已接入"；再确认写入的 `dist/hook-cli.js` 路径存在（缺失时 init 会拒绝并提示先构建（仓库内 `pnpm build`））。
- 验证守卫是否在工作：新会话里跑一条会被守卫看到的命令，或 `auto-guard guard status`（需 `--config-root` 指到 `~/.zcode/auto-guard` 或让 CLI 自动探测）。

## 权限被宿主配置默认禁用

- 守卫要写宿主配置文件（pi 的 `settings.json`、zcode 的 `config.json`）。若宿主处于"只读/安全模式"或配置文件被锁定（宿主正在运行且缓存了配置），写入会失败或被宿主下次启动覆盖。
- 做法：关闭宿主后再 init；写入前安装器会展示 diff 并强制备份（`*.auto-guard.bak`），失败时 `remove` 可还原。
- DSH 的接入走原生渠道 `dsh plugin add/remove`：若命令报权限错误，检查 dsh 自身的插件策略；`auto-guard list` 中 DSH 接入状态显示"未知"即说明查询命令失败。

## 其他

- 重复 init 安全：已接入条目自动跳过，已有备份不会被二次覆盖。
- 卸载后 `~/.<host>/auto-guard/`（规则、缓存、审计）**保留**；彻底清除需手动删除对应目录。
- 退出码：0 成功；2 = 有宿主失败 / 未检测到宿主 / 未知 `--host` 值（报错会列出可用值）。
