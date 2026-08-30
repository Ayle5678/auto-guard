# 0010 — Issue 02：数据活化——autoload 引擎 / 状态面板归位 / 每屏首访有内容

What to build:
- autoload 引擎：
  - `AppState.views[screen]` 增加 `loaded?: boolean`（或独立 `autoloaded: Partial<Record<ScreenId, boolean>>`）；屏首次进入（数字 / 方向键 / 初始态）且未加载时，reducer 产出新 effect `{ type: 'autoload', run: PendingRun }` 并置 busy（busyKey `busyRefresh`）。
  - `tui.ts` driver 执行 autoload：走 `execRun`（与显式命令同一 seam），完成后派发新事件 `autoload-done { screen, lines }` **只写 `views[screen]`，不写 receipts**（日志屏信噪比）。
  - 各屏 autoload 映射：guard→`guard recent 10`、examine→`examine status`、optimize→`optimize status`、set→`set show-key`、installer(status 子页)→`list`；dashboard/log/help 不需要。`r` 刷新 = 既有 refresh + 清 `loaded` 重跑当前屏。
  - 无当前根（未播种）时跳过（维持 `needRoot` 提示）。
- 状态面板归位（`lists.ts` / `dashboard.ts` 复用）：
  - 左列改为上下两面板：「状态」（`statusLines` 结构化读，带标题；examine/optimize 用 RootSummary 的 examineEnabled/auditCount 拼 2-4 行）+「动作」列表；右列「输出」不变。
  - guard/set 顶部裸文本状态条删除；set 屏向导 review 前导行保留（样式随新布局）。
- busy 期间输出面板维持现状（footer spinner 已有），autoload 完成贴底显示。

Blocked by: 01
Status: done

Acceptance:
- [x] 无头断言：guard 屏首访产出 `{ type:'autoload' }` effect；`autoload-done` 后 `views.guard.lines` 非空且 `receipts` 不变
- [x] examine/optimize 屏渲染含「状态」面板标题行；guard/set 不再有面板外裸文本状态行
- [x] `r` 重跑 autoload（`loaded` 复位）；二次进入同屏不重复加载
- [x] `pnpm -r typecheck` / `pnpm -r test` 全绿

## Comments

- 2026-08-30: 完成。新 effect {autoload} + 事件 {autoload-done}：reducer 首访置 autoloaded 标记并产出 effect，driver 经 execRun 执行后只写 views[screen] 不写 receipts；r 清标记重跑；无播种根跳过。状态面板归位：左列 = 状态 + 动作两面板，examine/optimize 用 RootSummary 结构化读拼 2-4 行（panelGuard/panelExamine/panelHistory/panelCount）；guard/set 顶部裸状态条删除。回归修复（0009 遗留 bug）：run-done 的贴底大 offset 在 renderListScreen/renderInstaller/renderLog 未 clamp 即 slice，回执输出被切空——这正是「输出框里什么也没有」的根因；三处渲染统一 clamp 后修复，并加 REGRESSION 无头断言。
- 2026-08-30（code-review 修复轮）: Standards/Spec 审查修复：busyKey 联合类型增 busyRefresh 且 autoload run 全部携带（footer 显示「加载中」，原回落 busyRun 不合 spec）；贴底 clamp 抽为 kit.clampOffset 三屏复用；app.ts 贴底视图抽 stickyView(receipt) 消除 run-done/autoload-done 重复；gotoScreen 单次计算 autoload 消除双重求值。
