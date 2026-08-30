# 0010 — Issue 03：品牌与 banner——cli 素字形导出 / 顶栏品牌化 / 总览字标 / 256 色扩展

What to build:
- `packages/cli/src/installer/banner.ts`：新增**纯函数导出** `renderBannerGrid(): string[]`——返回渲染后的素文本行（无 ANSI 码，含标语句行），`renderBanner` 改为在其上着色（行为零变化，`banner.spec.ts` 照绿 + 新增导出的断言）；`packages/cli/package.json` exports 增加映射 `./installer/banner`。
- `packages/tui/src/ui/theme.ts`：`sgrOf` 扩展 256 色前景（`Style` 增加可选 `fg256?: number`，仅供 banner 渐变；语义色板不动；`colorEnabled=false` 时照旧裸文本）。
- `app.ts` `render`：
  - 顶栏品牌 chip：大写 `AUTO GUARD`（accentBg）+ 版本号 chip（`createRequire` 读 tui `package.json`，缓存，失败 `?`）；宿主 / 根路径 / 语言 / on-off chip 保留。
  - dashboard body 顶部：终端 `width ≥ 62 && height ≥ 16` 时渲染字标 banner（cli 素网格逐行 Seg 化，按行 256 色渐变 `'51'→'45'→'39'→'33'→'27'→'21'→'93'`，与安装器同款）+ 标语行 `auto-guard v{version} · 守卫控制台 · cached command review`（双语灰字）；否则整块隐藏，布局自动回收行高。
  - banner 行数计入 dashboard body 高度预算；最小窗口（40×12）纪律不破。
- i18n：品牌标语 zh/en 成对。

Blocked by: 02
Status: done

Acceptance:
- [x] 无头断言：100×30 dashboard 渲染含 `AUTO GUARD` 字标行与版本号；40×12 不含且面板不越界
- [x] `banner.spec.ts` 原断言零改动通过；`renderBannerGrid` 无 ANSI 码（正则断言）
- [x] `NO_COLOR=1` 渲染：banner 行无 SGR 且文本仍在
- [x] `pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿

## Comments

- 2026-08-30: 完成。cli banner.ts 抽出 wordmarkRow/renderBannerGrid 素导出（renderBanner 行为零变化，banner.spec 原断言 + 新导出断言照绿），cli exports 增 ./installer/banner。theme Style 增 fg256，sgrOf 加 256 色分支（仅 banner 用）。顶栏品牌 chip = AUTO GUARD accentBg + v{tuiVersion()}（src/version.ts，createRequire 读自身 package.json）。总览字标随 bannerBlock 注入：阈值实施修正为 width≥110 且 height≥20（字标整幅 108 列，62 预估只算了 GUARD 单词，预览生成时发现截断即改），100×30/40×12 隐藏有断言。
- 2026-08-30（code-review 修复轮）: Standards 审查修复：BANNER_HUES 不再复刻 cli 渐变——cli GRADIENT 改数值型并导出，TUI 直接 import（单一事实源）；version.ts 改为模块加载期一次解析，render 期间零 I/O（对齐 ADR-0014 纯渲染纪律，同 cli banner 模块级预计算字形网格的房屋模式）。
