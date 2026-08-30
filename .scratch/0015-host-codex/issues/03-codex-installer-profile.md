# 03 — codex 安装器 profile + conformance/smoke 行

Status: done

Spec 0015。ADR-0008：纯 array-append，无新 op kind。

## Scope

- `profiles.ts`：HostId/HOST_IDS 增 `codex`；PackagePaths 增 codex；`CODEX_PRETOOLUSE_TEMPLATE`（matcher `^(Bash|apply_patch|Edit|Write)$`，`type:"command"` + timeout 90 秒）、`CODEX_SESSIONSTART_TEMPLATE`（matcher `^(startup|resume)$`，30 秒）；profile：detection `dirs ['.codex'] / files ['.codex/config.toml'] / executables ['codex']`、file `~/.codex/hooks.json`、markerSuffix `/host-codex/dist/{hook-cli,session-start}.js`；validateProfile 零错误。
- `install.ts` resolvePackagePaths 补 codex 两条。
- `i18n.ts`：`sessionNoteCodexHooksNoHotReload`、`codexTrustHint`（⚠ /hooks 信任门，未信任静默跳过）、`codexVerifyHint`（zh/en，MessageKey 强制对齐）。
- cli 测试：profiles.spec 补 codex 零错误行；detect/init/remove 按各文件既有宿主参数化模式补 codex 用例（hooks.json 写入、幂等、remove 逐字节还原）。
- `packages/conformance/review-loop.mjs` HOSTS 增 codex 行。
- `scripts/smoke/smoke-codex.mjs`：隔离 HOME，四断言（git status 静默 / rm -rf / deny / 补丁触 .env deny / 补丁普通文件静默）；根 package.json smoke 链接入。

## Accept

- `pnpm --filter @auto-guard/cli test` 全绿；smoke-codex PASS。
