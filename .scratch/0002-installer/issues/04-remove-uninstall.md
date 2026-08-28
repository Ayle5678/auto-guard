# 04 — `auto-guard remove` 完整卸载

What to build:
- `remove [--host ...] [--yes]`：按 profile 逆操作——从 pi extensions 数组移除路径、从 zcode hooks 移除 auto-guard 条目、撤销 dsh 插件注册；删除安装器创建的备份与拷贝文件；**不动** `~/.<host>/auto-guard/` 数据目录（用户数据保留，另有提示如何清除）。
- 从备份还原 vs 结构化移除两条路径：有备份则默认还原，无备份（如手动装过）则结构化编辑移除。

Blocked by: 02
Status: done

Acceptance:
- [x] init → remove 往返测试：宿主配置文件逐字节还原
- [x] remove 不存在的接入时报"未接入"而非破坏文件
- [x] 卸载后守卫在新会话确实不生效（冒烟：remove 后 list 显示未接入，宿主新会话无 auto-guard 条目可加载；完整会话冒烟需真实宿主运行时）
