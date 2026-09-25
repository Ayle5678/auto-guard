# 06 — hook 宿主门面瘦身（低优先，可无限期搁置）

**What to build:** hook 宿主的接入面缩到「描述符 + 入口 stub + 真宿主耦合件」：运行时导出绑定好的组合对象（或平级 bindHost(descriptor) 帮助器）；五宿主（zcode/claude/qoder/codex/opencode）的 bootstrap/config/hook-output/adapter 仪式再导出文件退成单行或删除；tests 与 conformance 的宿主 import 改指绑定帮助器。安装器 profile 与宿主包入口路径零改动（包不可删、可瘦）；opencode 的 payload builders 等真宿主耦合件保留。收益依赖下一个 hook 宿主是否到来——故本票低优先，frontier 允许长期跳过。

**Blocked by:** 05（宿主层收拢的收尾票）.

**Status:** needs-triage（低优先）— SPEC 0022 收尾时按 spec 预留的「可无限期搁置」保持未动工；收益依赖下一个 hook 宿主到来时再评估。

- [ ] 运行时导出绑定组合对象/bindHost；五宿主仪式文件退单行或删除
- [ ] tests/conformance import 改指帮助器后断言不动
- [ ] 安装器 profile 与宿主入口路径零改动（安装 smoke 绿）
- [ ] 五宿主 conformance 等价矩阵全绿；三门禁全绿
