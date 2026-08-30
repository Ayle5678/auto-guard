# 0010 — Guard TUI 交互与视觉 2.0（ux-polish）

## 背景

0009 真终端验收后用户三点不满 + 一点总评：

1. **没有设计的 auto-guard 标题 / banner**——顶栏只是一枚小写灰字 chip；安装器 CLI 的 ANSI Shadow 渐变字标（`packages/cli/src/installer/banner.ts`）这套既有品牌资产 TUI 没有用上。
2. **按键存在但无有效输出，输出框空置**——帮助屏声称 `←→/hl` 切页但只在安装屏生效，其余屏按下无声无息；审计/优化屏连状态条都没有（`statusStrip` 对这两屏返回空数组），右侧输出框永远停在「尚无命令执行」占位符。
3. **数字键 1-8 切页不合理**——主切屏方式应是方向键在页面栏上切换；数字键只能是快捷键。
4. **整体再精美一点**。

设计推理见 `docs/grill-log.md` Round 9（自问自答三轮，Q1–Q18）；ADR-0014 架构结论继续有效，本轮无新 ADR。

## 目标（= 用户四点的一一回应）

### G1 品牌：两件套

- **持久顶栏品牌化**（所有屏）：品牌 chip 重设计为大写 `AUTO GUARD` 强调色底 + 版本号（读 tui 自身 `package.json`，`createRequire`，失败回退 `?`）；上下文 chip（宿主 / 根路径 / 语言 / on-off）保留。
- **总览屏字标 banner**：与安装器同款 ANSI Shadow「AUTO GUARD」字标（AUTO / GUARD 同幅并排，7+1 行，青→蓝→紫逐行渐变）。经 cli banner 模块**新增纯函数导出**取素字形网格（行为零变化，原测试照绿），TUI 侧 Seg 化上色。显示条件 `width ≥ 110 && height ≥ 20`（实施修正：字标整幅 108 列，62 的估计只算了单词），否则整块隐藏（40×12 最小窗口纪律不破）。标语行：`auto-guard v{version} · 守卫控制台 · cached command review`（双语，灰字）。

### G2 数据活化：按键必有回响、面板永不空置

- **自动加载（autoload）**：屏首次进入自动执行只读命令填充输出面板——guard→`guard recent 10`、examine→`examine status`、optimize→`optimize status`、set→`set show-key`、安装屏 status 子页→`list`。仍走 `runCli`/`runInstallerCommand`（单一语义来源）。规则：
  - autoload **不写 receipts**（日志屏 = 用户显式动作 + `:` 模式，信噪比保住）；
  - 加载期置 busy（busyKey `busyRefresh`）——本地读几十毫秒，天然串行化防视图竞态；
  - `r` = 数据刷新 + 当前屏 autoload 重跑；
  - 每屏 `loaded` 标记防重复；无当前根（未播种）时跳过并维持 `needRoot` 提示；
  - **随附回归修复（0009 遗留）**：`run-done` 的贴底大 offset 在 renderListScreen / renderInstaller / renderLog 未 clamp 即 slice，回执输出被切空（0009 preview 的「guard with receipt」输出框即空）——三处统一 clamp，REGRESSION 无头断言钉死。
- **状态面板归位**：guard/set 屏顶部松散裸文本状态条收进左侧带标题「状态」面板（动作列表上方）；examine/optimize 补同款状态面板（数据源 = 既有 `RootSummary` 结构化读：examineEnabled / auditCount）。信息架构统一：左 = 状态 + 动作，右 = 输出。
- **notice 系统**：切屏 / 刷新 / 换根 / 确认取消 / 未勾选宿主等非命令动作，在 footer 左侧闪提示（如 `→ 守卫`、`已刷新`），下一次按键即消失（零定时器）；未绑定键保持静默（vim 惯例）。

### G3 导航：方向键为主，数字为快捷键

- `←` / `→`（及 `h` / `l`）升级为**全局切屏**：沿 `SCREEN_ORDER` 循环，页签高亮跟随，触发数据刷新语义（与数字键一致）。输入框 / 对话框 / 向导打开时照旧优先接管，无冲突。
- 数字 `1-8` 保留为快捷键；footer 提示改写为 `←→ 切屏`（数字不再出现为主导航文案）。
- 安装屏子页签（init/status/remove）改绑 **`Tab` / `Shift+Tab`**；`←→/hl` 不再承担子页切换。
- 帮助屏键位表改写到与新键位 100% 一致（含 `Tab/Shift+Tab` 子页、`←→` 切屏、数字降级为「跳转」）。

### G4 视觉打磨

- 面板 / 对话框边框圆角化 `┌┐└┘` → `╭╮╰╯`（同 U+250x 块，单宽零风险）。
- 页签条药丸化：活动 = 强调色底 ` 1 总览 `，非活动 = 灰字，数字保留药丸内。
- footer 键帽风格：键名亮色 / 说明灰字；右侧 busy spinner / 最近回执（✓ 绿 ✗ 红）不变。
- 危险动作行加 `⚠ ` 前缀（红样式已有）。
- `sgrOf` 扩展 **256 色分支**：仅供 banner 渐变（与安装器同款 `'51'→'93'` 色阶），语义色板 16 色不动；`NO_COLOR` 既有降级路径不变。
- chrome 禁 emoji（宽度与旧终端渲染风险）；只用 ● ✓ ✗ ⚠ ★ ❯ ↳ 制表符集。

## 边界（不要动的）

- core 零改动；cli 只加 `./installer/banner` 纯函数导出（`renderBannerGrid`，素文本字形行）+ 若 `renderBanner` 内部重构则行为零变化（现有 banner.spec 照绿）。
- 0009 的全部架构决策（ADR-0014）：零依赖、纯渲染、动作代理、退出纪律、非 TTY 拒绝——全部沿用。
- 不做鼠标 / 主题配置 / 实时裁决流（维持 0009 非目标）。
- 统一 CLI `set set-key` 的已知缺口不在本轮（0009 已记录）。
- `exitAfterBusies` 死字段等无关清理不做。

## 验收

- [x] `←→/hl` 在任意屏（dashboard/guard/examine/optimize/set/installer/log/help）切屏，页签高亮跟随；`Tab/Shift+Tab` 在安装屏换子页（无头断言）
- [x] guard 屏首次进入产生 autoload effect（`guard recent 10`）且完成后输出面板非空；autoload 不产生 receipt（无头断言）
- [x] 审计 / 优化屏有「状态」面板；所有列表屏输出面板首访即有内容（无头断言）
- [x] ≥110×20 总览渲染含 ANSI Shadow 字标；100×30 / 40×12 不含（无头断言 app.spec `brand + chrome rendering`）
- [x] 帮助屏含 `←→` 切屏与 `Tab/Shift+Tab`；footer 无「1-8 切屏」旧文案（无头断言）
- [x] notice：切屏 / 刷新后 footer 左侧出现提示，下一次按键消失（reducer 单测 app.spec `notice (SPEC 0010)`）
- [x] 双语全绿（新增 chrome 串全部 zh/en 成对）；`NO_COLOR` 渲染无 SGR 且布局不变
- [x] `pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿（805 tests）；preview.txt 重生成
- [x] docs/usage.md §6 键位描述更新

## 票据

见 `issues/`（01–05，tracer-bullet 顺序，`Blocked by:` 链式）。接手信息见 `handoff.md`。
