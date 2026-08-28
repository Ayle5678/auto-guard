# 04 — 安装器接线：语言选择持久化与 statusMessage

**What to build:** 安装时选的语言从此一直生效：交互提问选择后立即写入机器默认（不等安装结果），`init --lang en` 同样更新机器默认，之后再跑 init 不再重复提问；`remove` 保留语言偏好（与数据根保留同理），单独换语言无需重装。英文安装产出的 ZCode hook spinner 文案（statusMessage）为英文；对已装宿主重跑 init 不改写既有条目（marker 幂等）。安装器语言解析增加机器默认层：`--lang` > env > 机器默认 > TTY 提问 > 兜底。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 交互 init 选语言后机器默认落盘；二次 init 不再提问
- [ ] `init --lang en` 更新机器默认；`remove` 后文件保留
- [ ] 英文安装产出的 ZCode hook 条目 statusMessage 为英文；重跑 init 幂等不重写
