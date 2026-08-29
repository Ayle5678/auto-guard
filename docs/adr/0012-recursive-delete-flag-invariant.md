# 递归删除按不变式判定；模式枚举只是止血

裸 `rm -r`（无 `-f`）对目录的破坏力与 `rm -rf` 相同，却曾因不匹配 `rm -rf *` / `rm -fr *` 而落入 `unknown`：LLM 以 low risk 放行并写入 30 天持久缓存，重放免审（Qoder 实测发现，2026-08-29）。已修复：出厂规则 `directoryDelete` 与 `alwaysReview` 补 `rm -r *` / `rm --recursive *`（glob 大小写不敏感，`-R` 随之覆盖）。

本 ADR 记录的是判定语义的长期决策：**目录删除的判定目标是一条不变式——`rm` 携带任意拼写的递归 flag ⇒ directory-delete 流**，而不是一份手工枚举的拼写清单。落地方向是扩展既有数据驱动守卫机制（staticAllowGuards 的 `when` + token 精确 flag 结构，见 `rules.ts` 的 `matchStaticAllowGuard`），增加**短 flag 聚簇分解**语义：`-rf` 这类聚簇按字母分解后含 `r`/`R` 即命中，`--recursive` 按整词精确匹配。数据仍住在 rules.json，保持每宿主可编辑。

## Considered Options

- 继续纯模式枚举（现状止血）：排列发散，`rm -f -r`、`rm -rF` 等已漏过一次，每多一种写法多一条规则。
- shell AST / 解析器依赖：拒绝——core 零 npm 运行时依赖是 ADR-0002 明文约束；判定是词汇问题（命令词上挂没挂递归 flag）不是句法问题，AST 后仍需遍历取同样的 token 事实；解析失败仍需同一条 LLM 兜底路径；且 shell 的别名/分词/展开使解析树 ≠ 执行语义（`X='-rf'; rm $X dir` AST 无辜而执行递归删除），该类本就归变量替换检测 → LLM。

## Consequences

- `rm notes.txt` 等普通文件删除不受影响；`rm -ri` 等交互变体随不变式自然覆盖。
- 聚簇分解落地前，`rm -f -r` 等 flag 排列仍落 `unknown` 靠 LLM 兜底，为已知残余（工单跟进）。
- 分类不变式以数据表达（rules.json 新字段），不改 `classifySimple` 的类别优先序（hard-deny → directory-delete → …）。
