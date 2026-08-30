# research: OpenCode 插件与权限 API（2026-08-29 实测 + 官方文档；实现期补核 2026-08-29）

本机状态与 API 事实，支撑 spec 0004 与 ADR-0015。来源：本机 `~/.config/opencode/node_modules/@opencode-ai/plugin@1.18.9` 类型定义、`@opencode-ai/sdk` 类型、全局包 opencode-ai@1.18.19、opencode.ai/docs。

## 实现期补核（2026-08-29，工单 03 期间）

- **`permission.ask` hook 在 1.18.19 从未触发**：对编译产物 `opencode-windows-x64/bin/opencode.exe`（179MB）做字符串枚举，全部 `trigger("…")` 调用点为：`shell.env`、`tool.execute.before/after`、`tool.definition`、`chat.*`、`command.execute.before`、`file.open`、`tab.new`、`experimental.*` —— **无 `permission.ask`**（源码 v1.18.19 tag 同样没有）。与 [issue #7006](https://github.com/anomalyco/opencode/issues/7006) 一致：类型定义有、宿主不派发。内嵌 README 列出 `permission.ask` 属文档性列表。
- **实际可用的裁决通道**：插件 `event` hook 收到全部总线事件（编译产物确认：`V.event?.({event:{id,type,properties}})`），其中 `permission.asked` 事件属性为 V1 形态 `{id, sessionID, permission, patterns, metadata, always, tool:{messageID, callID}}`；`PluginInput.client` 是完整 SDK client，`client.permission.reply({requestID, reply:"once"|"always"|"reject", message?})` 可编程答复（v2 SDK `Permission.reply` 确认）。
- **结论（ADR-0015 修订）**：守卫经 `event` hook 监听 `permission.asked`，spawn hook-cli 裁决后 allow→reply once、deny→reply reject（message=理由，作为 feedback 回给 agent）、ask→不答复落原生 TUI。`permission.ask` hook 实现保留作前向兼容（未来版本若开始派发即自动生效）。installer 仍写 `"*":"ask"` permission 规则——它是产生 `permission.asked` 事件与 TUI ask 面的来源。
- **metadata 运行时键名（源码 dev 分支 tool 实现）**：bash → `{command}`（external_directory 变体另带 directories/patterns）；edit → `{filepath, diff}`（**小写 filepath**，绝对路径）；read → `{}`（**空**，路径在 patterns[0]，worktree 相对）。适配链：bash 取 metadata.command ?? patterns[0]；edit/read 取 metadata.filepath ?? join(worktree, patterns[0])。
- 启动器已修复：`node C:/Users/Administrator/AppData/Roaming/npm/node_modules/opencode-ai/postinstall.mjs` 后 `opencode --version` → 1.18.19。

## 本机安装状态

- 全局包：`C:\Users\Administrator\AppData\Roaming\npm\node_modules\opencode-ai\`，版本 1.18.19，bin 指向 `./bin/opencode.exe`。
- **启动器损坏**：npm 安装时 postinstall 未执行（`--ignore-scripts`），`opencode --version` 报 "postinstall script was not run"。平台二进制 `opencode-windows-x64`（含 -baseline）已在 node_modules 中。修复：`node C:/Users/Administrator/AppData/Roaming/npm/node_modules/opencode-ai/postinstall.mjs`。
- 配置：`~/.config/opencode/opencode.json` 当前 `{"$schema":"...","plugin":[]}`；另有 opencode.jsonc；`node_modules` 里装有 `@opencode-ai/plugin@1.18.9`（package.json dependencies）。
- 历史：`opencode.json.clawd-cleanup-*.bak` 显示 clawd 曾用 `"plugin": ["D:/Program Files/Clawd on Desk/resources/app.asar.unpacked/hooks/opencode-plugin"]`——**本地路径条目可用**的实证。

## 插件 Hooks（`@opencode-ai/plugin/dist/index.d.ts`）

- `Plugin = (input: PluginInput, options?) => Promise<Hooks>`；插件模块导出一个或多个具名 `export const` 插件函数（文档模式，无 default export）。
- **`"permission.ask"?`**（index.d.ts:225）：`(input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>`——插件**改写 output.status** 表达裁决；不改写 = 落原生 TUI。
- **`"tool.execute.before"?`**（index.d.ts:235）：`(input: { tool, sessionID, callID }, output: { args }) => Promise<void>`——可改 args；**block = throw Error**（官方 .env 保护示例：`throw new Error("Do not read .env files")`）。
- 其他：`"tool.execute.after"`、`"event"`、`"config"`（可改 Config）、`"chat.*"`、`"shell.env"`、`"tool.definition"` 等，全文见该文件。
- `Config.plugin?: Array<string | [string, PluginOptions]>`（index.d.ts:48）。

## Permission 输入类型（`@opencode-ai/sdk/dist/gen/types.gen.d.ts:369`）

```ts
export type Permission = {
    id: string
    type: string                    // 权限键：bash / edit / read / …
    pattern?: string | Array<string>
    sessionID: string
    messageID: string
    callID?: string
    title: string
    metadata: { [key: string]: unknown }   // 命令/路径等工具参数在 metadata，确切键名实现期核实
    time: { created: number }
}
```

## permission 配置（官方 docs/permissions）

- opencode.json `"permission"`：全局值或按工具对象；动作 `"allow" | "ask" | "deny"`。
- 对象语法 `{"*": "ask", "git *": "allow"}`：`*` 匹零或多字符、`?` 恰一字符；**后者匹配者优先**（last matching rule wins）——auto-guard 的 `"*": "ask"` 必须插到对象首位。
- 内置权限键：`read`、`edit`（覆盖 edit/write/patch）、`bash`、`glob`、`grep`、`task`、`skill`、`webfetch`、`websearch`、`external_directory`、`doom_loop` 等；默认大多 allow，`read` 自带 `.env` deny 规则。
- TUI ask 三态：**once / reject / always**（always = 本会话内同模式放行，之后绕过守卫——ADR-0015 接受的宿主委托语义）。
- 文档 permissions 页未提及 permission.ask hook 的触发时序（相对配置规则），实现期需真机核实：仅 ask 规则触发，还是 deny/allow 也触发。

## 插件注册（官方 docs/plugins）

- `plugin` 数组：npm 包名（启动时 Bun 自动装到 `~/.cache/opencode/node_modules/`）或本地路径。
- 本地文件目录自动加载：项目 `.opencode/plugins/`、全局 `~/.config/opencode/plugins/`（复数），.js/.ts 均可。
- 加载顺序：global config → project config → global plugin dir → project plugin dir；所有来源的 hook 依序执行。

## 工具名（官方文档/权限键）

`bash`、`read`、`edit`、`write`、`patch`、`glob`、`grep`、`webfetch`、`websearch`、`task` 等；守卫映射：bash→bash、edit/write/patch→edit、read→read。
