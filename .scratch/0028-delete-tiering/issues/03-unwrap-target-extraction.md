# 03 — 剥壳修复：powershell/cmd 包裹删除的目标提取

**What to build:** 删除目标提取（重试邻居匹配的数据源）在 token 遍历前先剥包装：`powershell`/`pwsh`（含 `-NoProfile` 等任意参数 + `-Command`）与 `cmd /c|/k` 剥出引号内层命令（`command <builtin>` 换轴既有）；内层按 `;` 与 `&&` 拆语句，逐条走既有首词判断提目标。用户侧效果：`powershell -NoProfile -Command "Remove-Item 'C:\...' -Recurse -Force"` 被拦后，带 `[删除理由]` 的重试一次接上协议（精确或邻居匹配），消除 9-30 式"理由贴不上"六连拒循环。分类层不动：Remove-Item 经运行时 stat 检测入口进删除流，anchored glob 无需扩展。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] powershell 包裹（含 -NoProfile/-NonInteractive 等参数、双引号内单引号路径）首击拒 → 同目标裸 `rm` 带理由重试 → 邻居匹配命中 → 进复审（不再二次要理由）——seam 级 e2e 用例（delete-tier-wiring.spec.ts 末节）
- [x] 精确重试路径回归：剥壳不影响既有 `rm -rf x [删除理由] …` 精确匹配用例（guard-service 既有用例全绿）
- [x] 内层多语句 `"Stop-Process …; Remove-Item <p>"` 与 `&&` 连接形态：删除语句目标全提、非删除语句不提（directory-delete-unwrap.spec.ts）
- [x] 非删除的 powershell 命令剥壳后仍提不出目标（不误伤；引号内数据、echo 参数均不提）
- [x] 既有 directory-delete 相关用例全绿（-EncodedCommand 不剥壳有用例钉住）

## Comments

- 与 01/02 无阻塞但协同：剥壳提出的目标供分级（02 已在 Comments 注明）；先 03 后 01-02 会让 powershell 包裹删除一开始就进入分级覆盖。
