# 01 — 宿主 profile 数据与检测

What to build:
- `profiles/` 数据目录：dsh / pi / zcode 三条 profile（检测特征、写入位置、内容模板、卸载规则），schema + 校验。
- 检测器：扫描 fake-able HOME，输出"检测到的宿主 + 置信度 + 证据"列表。
- `auto-guard list`：渲染检测结果与当前接入状态（读宿主配置文件判断是否已接入）。

Blocked by: SPEC 0001 #01（monorepo 骨架）
Status: done

Acceptance:
- [x] 三条 profile 有 schema 校验测试
- [x] 检测器在临时目录集成测试中正确识别 dsh/pi/zcode 特征与"全部未装"
- [x] `list` 在未接入时输出明确的下一步指引
