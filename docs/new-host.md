# 接入新宿主：一条 profile + 一个适配层包

auto-guard 的安装器是数据驱动的（ADR-0008）：新增宿主时，你写一个新的 `@auto-guard/host-*` 适配层包，再给安装器加一条 profile——通常**不需要改安装器逻辑**。唯一的例外是宿主需要一种全新类型的写入（op kind，见 §2 末尾）。本文是面向贡献者的最小指南。

## 1. 适配层包

在 `packages/host-<id>/` 建包（参考 `host-pi`：零构建、jiti 直跑 TS；参考 `host-zcode` / `host-claude`：预构建 dist + 进程 hook；参考 `host-opencode`：插件跑在宿主进程内、每次裁决 spawn node 子进程）。硬约束：

- 只依赖 `@auto-guard/core`（+宿主 SDK 的 peer/dev 依赖或零依赖结构类型——`host-pi/src/pi-sdk.d.ts`、`host-opencode/src/opencode-plugin-types.ts` 先例）；守卫逻辑一律进 core（ADR-0002）。
- 包内实现"决策协议翻译"：把宿主事件翻译成 `GuardService.decide(GuardRequest)`，再把 Decision 翻译回宿主动作。
- 一份能力声明（ADR-0007，`*-capabilities.ts`）与独立配置根（ADR-0003，`~/.<host>/auto-guard/`）。

## 2. 安装器 profile

profile 在 `packages/cli/src/installer/profiles.ts` 的 `PROFILES` 数组里，一条记录四个部分：

```ts
{
  id: 'myhost',                       // 短名，用于 --host myhost
  label: 'MyHost',
  detection: {                        // 检测启发式：目录 + 标志文件 + 可执行文件
    dirs: ['.myhost'],
    files: ['.myhost/cli/config.json'],   // 文件证据最强（high 置信度）
    executables: ['myhost'],
  },
  sessionNote: 'hooks 无热重载，必须新开 MyHost 会话',
  postInstallNotes: ['验证：…', '⚠ 已知风险：…'],   // 可选：init 摘要里的宿主专属提示/警示
  action: {
    kind: 'json-merge',               // 纯文件型宿主用 json-merge
    file: '~/.myhost/cli/config.json',
    requiredTokens: ['${AUTO_GUARD_MYHOST_ENTRY}'],  // 写入前必须存在的构建产物
    ops: [
      {
        kind: 'array-append',                       // 向数组追加一个元素
        arrayPath: ['hooks', 'PreToolUse'],          // 目标数组（不存在则创建）
        template: '{"matcher":"^(Bash)$","hooks":[{"type":"process","command":"node","args":["${AUTO_GUARD_MYHOST_ENTRY}"]}]}',
        markerSuffix: '/host-myhost/dist/hook-cli.js', // 识别"这条是我们的"的规范化后缀
      },
    ],
  },
}
```

要点：

- **模板**是带 `${TOKEN}` 占位符的 JSON 串。新包路径需要新 token 时，在 `TOKENS` 表加一行并让 `resolvePackagePaths()`（`install.ts`）解析出该包的真实路径；JSON 内嵌的路径会自动做 JSON 字符串转义。
- **markerSuffix** 是幂等与卸载的锚点：init 靠它跳过已接入条目，remove 靠它只删 auto-guard 的条目、不碰用户自己的配置。取"我们写入路径里最稳定的后缀"（如 `/<pkg>/dist/<entry>.js`）。
- 若宿主只能通过 CLI 注册插件（无纯文件渠道），用 `action.kind: 'command'`（参考 dsh profile）：声明 `installArgs` / `removeArgs` / `listArgs`，安装器走"查状态 → 执行 → 失败即报错"路径。
- 写完后跑 `validateProfile`（`packages/cli/tests/installer/profiles.spec.ts`）补一条用例：新 profile 必须零错误。

**新 op kind（唯一需要动安装器的场景）**：宿主的写入不是"向某数组追加元素"时，在 `MergeOp` 联合类型里加一种 op（先例：opencode 的 `permission-ask-rules`，向 permission 各工具对象**首位**插入 `"*": "ask"`——opencode 后匹配者优先，用户规则必须在前故优先）。op kind 是封闭集合：新 kind 要同步改四处——`plan.ts`（buildInitPlan 写入语义）、`integration.ts`（接入状态判定）、`remove.ts`（卸载语义；做不到归属区分的写入在文档里说明保留）、`profiles.ts`（validateProfile 模式校验）。除此之外新增宿主仍只是加 profile。

## 3. 测试清单（照抄现有宿主的 spec）

- 检测：临时 HOME 下 `dirs/files/executables` 各命中一次 + 全未装（`detect.spec.ts`）。
- init：假 HOME + 注入 paths，断言写入内容、`*.auto-guard.bak` 备份、二次 init 幂等（`plan.spec.ts`、`init.spec.ts`）。
- remove：init → remove 逐字节还原；无备份时结构化移除且不碰用户条目（`remove-list.spec.ts`）。
- 新 op kind：三种既有文档形态（空 / 部分配置 / 已写入）的幂等与还原语义各一条。

## 4. 文档

- 根 README（中英）的宿主矩阵加一列、安装渠道一句话。
- `docs/cli.md` 安装器 flags 不变（`--host <id>` 即新 id）。
- `docs/usage.md` §2.6 宿主写入对照表加一行；宿主有专属风险/修复指引时加警示段（先例：claude 的 cc-switch 覆写警示、opencode 的启动器修复）。
