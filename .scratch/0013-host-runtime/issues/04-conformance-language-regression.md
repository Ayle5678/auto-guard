# 04 — conformance 改造 + 语言回归

What to build:

- conformance 去掉自写的第 7 份 GuardDeps 接线：改为经 `createHookHost(各宿主描述符)` 组装，等价场景表对四描述符跑同一运行时。
- 删除 qoder≡claude 序列化器逐字节 pin（此时已是同一函数，同义反复——迁移完成后才删）。
- 新增契约测试「**描述符差异只应体现在声明数据**」：同一场景下若两宿主守卫行为不同，唯一合法原因是描述符声明不同（工具表/能力值/序列化器），否则即配置错。
- 语言回归矩阵：四宿主 × zh/en 的 fail-closed 阶梯与提示文案（含 `set lang` 生效路径）。

Blocked by: 02, 03

Status: done

Acceptance:

- [x] conformance 等价矩阵 + fail-closed 矩阵四宿主全绿（经 createHookHost 组装）
- [x] 逐字节 pin 删除、契约测试就位且能抓「配置错」类注入故障（自证有效）
- [x] 语言矩阵绿；三门禁全绿
