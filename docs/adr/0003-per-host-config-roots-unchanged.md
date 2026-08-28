# 配置根继续按宿主隔离，路径不变，零用户迁移

三个前代各占 `~/.dsh/auto-guard/`、`~/.pi/auto-guard/`、`~/.zcode/auto-guard/`（zcode ADR-0002、pi ADR-0003）。合并后 core 的 config schema 统一为超集，但**数据根不合并**：schema 演进互不破坏，且路径不变意味着现有用户升级 = 换代码、数据原地续用，零迁移。跨宿主共享（缓存预热、规则同步）只作为未来 opt-in 的导入导出桥，绝不做自动共享。

## Consequences

- 历史层与学习规则按宿主独立积累（zcode ADR-0002 的原判断继续成立）。
- core 代码中不得出现单一配置根常量；根路径由宿主适配层传入。
