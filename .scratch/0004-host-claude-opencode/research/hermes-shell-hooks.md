# research: Hermes shell-hook 机制（2026-08-28 源码深查，暂缓适配）

结论：**暂缓**。shell hook 只有 block/放行两态、无 ask 通道；宿主侧 fail-open；注册只能手改 config.yaml。将来适配建议改走 Python 插件（`approve` 指令可升级 hermes 原生审批门 = 真 ask）。

源码根：`C:\Users\Administrator\AppData\Local\hermes\hermes-agent\`（下称 `<src>`）；运行时数据目录 `%LOCALAPPDATA%\hermes\`。本机 hermes-agent v0.18.2（Python 3.11）。

## 注册

- **只能手改 config.yaml**（`%LOCALAPPDATA%\hermes\config.yaml`；`hermes hooks` 子命令只有 list/test/revoke/doctor，`hermes config set` 写不了列表）：
  ```yaml
  hooks:
    pre_tool_call:
      - matcher: "^(terminal|read_file|write_file|patch)$"   # 可选，re.fullmatch 于 tool_name，大小写敏感
        command: "node C:/path/hook-cli.js"                   # shlex.split + shell=False；Windows 路径用正斜杠
        timeout: 120                                          # 默认 60，上限 300
  ```
- Schema：`<src>\agent\shell_hooks.py:160-196`（ShellHookSpec）、`:305-422`（解析）；文档 `<src>\website\docs\user-guide\features\hooks.md`。

## pre_tool_call 协议（`<src>\agent\shell_hooks.py`）

- stdin：`{"hook_event_name", "tool_name", "tool_input"(来自 args), "session_id", "cwd", "extra":{task_id, tool_call_id, turn_id,…}}`（`:536-552`）。
- stdout：deny = `{"decision":"block","reason":"…"}`（Claude Code 风格，兼容）或 `{"action":"block","message":"…"}`；**其余一切输出 = 放行**；无显式 allow、无 ask、无改参通道（`:566-620`）。
- **fail-open**：spawn 失败/超时/非 JSON 输出一律放行（`:475-514`）；非零退出码仍解析 stdout（`:522-529`）。守卫 crash = 全放行，fail-closed 得靠适配器自身 catch-all 输出 block，node 起不来则无解。
- matcher：`re.fullmatch(tool_name)`，不配 = 全工具（`:187-196`）。

## 工具名

执行 shell = `terminal`；读 = `read_file`；写 = `write_file`；编辑 = `patch`；搜索 = `search_files`。另有 browser_*、delegate_task、mcp__<server>__<tool> 等大量工具（`<src>\tools\*.py` 的 `registry.register`）。

## Consent / allowlist

- `%LOCALAPPDATA%\hermes\shell-hooks-allowlist.json`：`{"approvals":[{"event","command","approved_at","script_mtime_at_approval"}]}`，按 event+command 精确匹配（`:627-685`）；**预写此文件可免 TTY 确认**（原子写 `:646-675`）。
- 三个 opt-in 通道（OR）：`--accept-hooks` 旗标 / `HERMES_ACCEPT_HOOKS` env / config `hooks_auto_accept: true`（`:834-854`）。非 TTY 且未 opt-in → 拒绝注册。`HERMES_SAFE_MODE=1` 整体跳过 hook。
- 撤销：`hermes hooks revoke <command>`。

## 路径解析（`<src>\hermes_constants.py:55-113`）

`HERMES_HOME` env → 平台默认：Windows `%LOCALAPPDATA%\hermes`，POSIX `~/.hermes`。**与安装器 `~/` 相对路径模型冲突**（本机配置实际在 AppData），是当时权衡的难点之一。

## Python 插件路线（将来真 ask 的入口）

插件层支持 `{"action":"approve","message":"…","rule_key":"…"}` 升级到 `tools.approval.request_tool_approval` 人工审批门，gate 出错 fail-closed 成 block（`<src>\hermes_cli\plugins.py:2113-2123, 2244-2278`）。插件块决定平局时优先于 shell hook。

## 安全备注（与适配无关，已提醒用户）

本机 `%LOCALAPPDATA%\hermes\config.yaml` 的 `custom_providers` 下有明文 DeepSeek / OpenRouter API key，建议尽快迁移到加密存储。
