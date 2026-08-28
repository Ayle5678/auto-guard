# 04 — opencode 安装器 profile（plugin 数组 + permission 规则）

What to build:
- `profiles.ts` 增 opencode profile：
  - detection：dirs `['.config/opencode']`，files `['.config/opencode/opencode.json']`，executables `['opencode']`（启动器损坏时文件证据仍成立）。
  - action json-merge → `~/.config/opencode/opencode.json`：
    - op1：`plugin` 数组追加 `${AUTO_GUARD_OPENCODE_PLUGIN}`，指向 host-opencode 包目录或 dist 单文件——clawd 备份（`opencode.json.clawd-cleanup-*.bak`）证明本地路径条目可行；两种形态各做一次真实加载冒烟后定。markerSuffix `/host-opencode`。
    - op2（**新 op kind**，安装器逻辑扩展；理由：ADR-0008 显式写入、备份、可还原，拒绝插件 config hook 运行时自改）：permission 对象写入——对 `bash`/`edit`/`read` 三键：键不存在 → 写 `{"*": "ask"}`；存在但无 `"*"` → 在对象**首位**插入 `"*": "ask"`（JS 对象保序；opencode 后者匹配者优先，用户既有规则在前故优先）；已有 `"*"` → no-op。remove 撤销 plugin 数组条目；permission 的 `"*"` 不回删（无法区分归属，文档说明）。
- `PackagePaths` 增 opencode 条目 + `TOKENS` 增对应 token。

Blocked by: 03
Status: done

Acceptance:
- [x] 单测：空 permission / 部分配置 / 已有 `"*"` 三种 opencode.json 形态的写入幂等 + remove 还原（plugin 条目删除、permission 保留）
- [ ] init 冒烟：真实 opencode 启动加载插件（插件列表/日志可见）——待人工（交互式 TUI 启动验证；plugin 条目指向 dist 目录，clawd 本地路径先例 + smoke 已验证插件模块可被加载执行）

## 实施期定案（2026-08-29）

- plugin 条目指向 **dist 目录**（markerSuffix `/host-opencode/dist`）：目录形态与本机 clawd 备份先例一致；dist/index.js 兼作单文件入口，两种形态都可用。
- 补充语义：permission 键为全局字符串动作（如 `"bash": "allow"`）时跳过不覆盖，diff 中说明（工单未覆盖的第三种形态）。
