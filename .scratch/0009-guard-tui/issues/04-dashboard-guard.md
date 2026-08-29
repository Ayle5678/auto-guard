# 0009 — Issue 04：总览 + 守卫屏

What to build:
- 总览屏（屏 1）：每宿主状态卡（复用聚合逻辑：PROFILES × existsSync 门控；seeded 根渲染 `statusLines` 摘要、unseeded 提示、缺席跳过），显示 on/off、key 状态（`hasStoredApiKey`/env）、examine 开关与条数、语言；卡上可 `Enter` 选为当前根；`ping` 按钮（busy）。
- 守卫屏（屏 2）：
  - on/off 开关行（Space/Enter 切换 → `guard on|off`，回执进 footer）；
  - status 详情面板（`statusLines` 输出原样进面板）；
  - `recent` 列表（默认 10，`n` 可调：内联输入，1–99）；空历史有友好提示；
  - `report [days]`（内联输入天数，默认 7；examine 关时显示原提示）；
  - `ping`（busy spinner → 成功/失败回执着色）。
- 数据读取走结构化读（`loadConfig` + `readStatus` + `readRecentDecisions` + audit count），动作走 `mgmt`。

Blocked by: 03
Status: done

Acceptance:
- [x] 总览卡与 `auto-guard guard status`（无显式根）聚合视图信息等价（同根集、同 seeded/unseeded 判定）
- [x] 守卫屏五个动作全部产生回执且刷新后状态一致
- [x] 空状态（无历史/无 examine）不崩、有提示
- [x] 单测：注入假根目录集合断言卡片分类与选中行为

## Comments

- 2026-08-30: 完成。总览 = 每宿主卡片（聚合语义：seeded/unseeded/absent）+ statusLines 详情 + Enter 选根 + p ping（显式 --config-root）；守卫屏 = 开关/status/recent(n)/stats/report(天数)/ping 六动作。空状态走 needRoot/noRoot 提示。
