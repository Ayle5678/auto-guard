# 01 — rm 递归 flag 聚簇不变式守卫（core）

**What to build:** agent 在任意宿主跑 `rm` 携带任意拼写的递归 flag（`-r`、`-R`、`-rf`、`-fr`、`-f -r`、`-rF`、`--recursive`）时，一律进入目录删除复核流：先拒一次、要求 `[删除理由]` 重试、LLM 低推理复核恰好一次、任何结果不写持久缓存。`rm notes.txt` 等普通文件删除不受影响。判定数据住 rules.json 新顶层字段（出厂默认带一条 `rm` 守卫），短 flag 聚簇按字母分解含 `r`/`R` 即命中，`--recursive` 整词精确（含 `=` 形态）；分类器类别优先序不变（ADR-0012）。新顶层字段借既有播种补齐机制自动到达存量安装的 defaults.json 与用户 rules.json。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 命中样例全绿：`rm -r x`、`rm -R x`、`rm -rf x`、`rm -fr x`、`rm -f -r x`、`rm -rF x`、`rm --recursive x`、`rm --recursive=... x` 全部归类目录删除
- [ ] 不命中样例全绿：`rm x`、`rm -i x`、`git branch -r`、`echo "rm -r x"` 不触发目录删除类别
- [ ] 守卫语义测试覆盖聚簇分解边界（对齐 staticAllowGuards 先例的 `-describe` ≠ `-d` 风格：如 `rm -urn x` 命中、`rm --force x` 不命中）
- [ ] GuardService 端到端：`rm -f -r ./dir` 首次返回 deny + needsReason，持久缓存无该命令条目（先红后绿）
- [ ] 分类器既有类别判定顺序与全部现有分类用例不回归
- [ ] 出厂默认携带新字段；加载链对缺该字段的旧配置根自动补齐
