# auto-guard

统一的多宿主命令审查守卫（auto-guard）——一个核心裁决引擎 + 每宿主薄适配层 + 安装器。合并自三个同源前代项目：`dsh-auto-guard`（DeepSeek Harness 插件）、`pi-auto-guard`（Pi 扩展）、`zcode-auto-guard`（ZCode PreToolUse hook 插件）。

## Agent skills

### Issue tracker

Issues 以本地 markdown 形式存放在 `.scratch/<feature-slug>/`（每功能一个目录，spec 为 `spec.md`，工单一票一文件）。See `docs/agents/issue-tracker.md`.

### Triage labels

使用五个标准 triage 角色（`needs-triage` 等），写在工单文件的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context：根目录一份 `CONTEXT.md`（术语表）+ `docs/adr/`（架构决策）+ `docs/grill-log.md`（设计自问自答记录）。See `docs/agents/domain.md`.

## Ground rules

- 本仓库当前处于**文档阶段**：CONTEXT / ADR / spec / tickets 已定，实施未开始。改动设计前先读 `docs/grill-log.md` 和 `docs/adr/`。
- 前代项目的 spec 约定（`.scratch/NNNN-slug/` + `issues/NN-slug.md` + `Status:` 行）原样沿用。
- 核心模块保持零宿主依赖（仅 Node 内置模块）；宿主耦合只允许出现在 `packages/host-*` 适配层。见 ADR-0002。
