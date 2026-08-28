# 01 — i18n 目录与语言解析

What to build:
- `packages/cli/src/installer/i18n.ts`：`Lang` 类型、中英扁平目录（键一致，类型强制对齐）、`message(lang, key, params)`、`normalizeLang`（区域写法）、`envLang()`（`AUTO_GUARD_LANG`）、固定双语的 `invalidLangMessage`。
- `--lang <zh|en>` 进 `parseInstallerArgs`（报错本地化；`runInstallerCommand` 预扫描使解析错误也说对语言）。
- profiles 的 `sessionNote` 由中文字面量改为消息键，`validateProfile` 校验键存在。

Blocked by: —
Status: done

Acceptance:
- [x] `EN` 目录缺键时 typecheck 失败（`Record<MessageKey, string>`）
- [x] `--lang fr` 报固定双语错误，退出码 2
- [x] `normalizeLang(' zh-CN ') === 'zh'`、`normalizeLang('fr') === undefined`
