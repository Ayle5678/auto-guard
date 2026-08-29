# 0009 — Issue 03：命令接驳——runCli 代理 / 日志屏 / `:` 命令模式 / 根选择器

What to build:
- `packages/cli/package.json` 加 exports 映射：`./shell`、`./status-store`、`./installer`、`./profiles`（逻辑零改动，ADR-0014）。
- `src/actions.ts`：动作层。管理命令 `mgmt(argv)` = `runCli([...argv, '--config-root', root])`；安装器命令 `inst(argv)` = `runInstallerCommand(argv)`；返回 `{code, output}` 统一进日志。所有动作发前置 `busy` 事件、完成发 `done` 事件（ping/analyze 等异步可观测）。
- 日志屏（屏 7）：命令 + 退出码 + 输出流水，可滚（g/G/↑↓）；对 `set set-key` / `set-api` 类回执只显示原样输出（runCli 输出本身已脱敏）；`: `命令回显带前缀。
- `:` 命令模式：底部内联输入，空格分割 argv，`init|list|remove` 开头走 `inst`、其余走 `mgmt`（自动补 `--config-root`）；回车执行、Esc 取消；回执进日志 + footer。这是全命令面保底通道。
- 根选择器：自动检测（`detectConfigRoot` 同序）为默认根；总览屏可循环切换六个标准根（PROFILES）+ 「聚合」虚拟根（聚合时 guard/status 类动作要求先选定具体根——`:` 命令显式 `--config-root` 优先）。
- 事件循环接线：动作异步执行期间锁输入（仅 q/Ctrl+C 可退出），完成后刷新当前屏数据。

Blocked by: 02
Status: ready-for-agent

Acceptance:
- [ ] `:` 模式跑 `guard status`、`init list`、`optimize status` 均得到与命令行一致的输出与退出码（用注入假 CliDeps 断言）
- [ ] 动作期间 UI 锁定 + spinner，完成后自动刷新
- [ ] 根切换后所有屏数据跟随（配置根显示在头部）
- [ ] 单测覆盖 argv 分派规则（installer 三命令 vs 管理命令）与 `--config-root` 注入
