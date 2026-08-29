# 02 — qoder 安装器 profile

What to build:
- `packages/cli/src/installer/profiles.ts`：
  - `HostId` 联合类型与 `HOST_IDS` 增 `'qoder'`。
  - `PackagePaths` 增 `qoder: { distHookCli: string; distSessionStart: string }`；`TOKENS` 增 `${AUTO_GUARD_QODER_HOOK_CLI}`、`${AUTO_GUARD_QODER_SESSION_START}`（json: true）。
  - `PROFILES` 增条目（镜像 claude 条目）：`{ id: 'qoder', label: 'Qoder', detection: { dirs: ['.qoder'], files: ['.qoder/settings.json'], executables: ['qoder'] }, sessionNote: 'sessionNoteQoderHooksNoHotReload', postInstallNotes: ['qoderVerifyHint'], action: { kind: 'json-merge', file: '~/.qoder/settings.json', requiredTokens: [两个 qoder token], ops: [array-append hooks.PreToolUse + array-append hooks.SessionStart], } }`。
  - 模板：`{"matcher":"…","hooks":[{"type":"command","command":"node \"${AUTO_GUARD_QODER_HOOK_CLI}\"","timeout":90}]}` 形态（type 是 command 不是 process；timeout 单位秒）；PreToolUse matcher 用 01 工单实机验证结论（双命名锚定正则或 `"*"`）；SessionStart matcher 同（timeout 30）；markerSuffix `/host-qoder/dist/hook-cli.js`、`/host-qoder/dist/session-start.js`。
- `detect.ts` / `install.ts` / `plan.ts` / `remove.ts` / `integration.ts`：预期随 profiles 数据驱动零逻辑改动，逐个确认无 host 名硬编码（对照 0004 的 claude/opencode 接入 diff）。
- `i18n.ts`（中英两个目录都要，MessageKey 类型强制对齐）：
  - `usage` / `uninstallHint` 的宿主列表加 `qoder`。
  - 新增 `sessionNoteQoderHooksNoHotReload`（"hooks 无热重载，必须新开 Qoder 会话"）、`qoderVerifyHint`（`guard ping` 验证提示，照 claudeVerifyHint 措辞）。
- 仓库登记：根 `package.json` workspaces、pnpm-workspace（如有）、conformance 的宿主清单常量（若存在）——以 0004 接入 claude/opencode 时动过的文件清单为准。
- `validateProfile`：kind-based 校验预期直接通过，不改动。

Blocked by: 01
Status: done

Acceptance:
- [x] `auto-guard init --host qoder` 写入 `~/.qoder/settings.json` 正确结构；重复执行幂等；`auto-guard remove --host qoder` 完整卸载（settings.json 其余内容不动）
- [x] 中英文案齐全，类型检查（MessageKey 对齐）通过
- [x] `validateProfile(qoder)` 无错误；init 汇总出现 sessionNote 与 verifyHint 文案
- [ ] 新会话实测：Qoder 里跑一条 bash 命令出现守卫审查（联动 01 的实机验证）

## Comments

### 实施结论（2026-08-29）

- init/remove 往返由 `remove-list.spec.ts` 新增集成测试覆盖（用户 hooks 保留、备份逐字节还原）；detect/profiles/plan/i18n/banner 六个 spec 均补 qoder 断言。
- banner 宿主清单从 `HOST_IDS` 派生（0.3.x 更名引入），qoder 自动出现在头图，无需改 banner 代码。
- 最后一项「新会话实测」需要真实 Qoder agent 会话，留给用户首装时执行（与 01 工单的实机验证项同一批）。
