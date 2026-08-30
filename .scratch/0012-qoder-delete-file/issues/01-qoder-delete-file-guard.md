# 01 — qoder delete_file 守卫

What to build:

- `packages/cli/src/installer/profiles.ts`：qoder profile 的 PreToolUse matcher 追加 `delete_file`（列表变为十名）。
- `packages/host-qoder/src/qoder-adapter.ts`：
  - `GUARDED_TOOL_NAMES` 加 `delete_file: 'bash'`。
  - 新增合成：路径经防御链（`file_path/filePath/filepath/path`）取值，合成为 `rm "<路径>"` 作为 `GuardRequest.command`（路径含空格/引号须正确包裹，引号须转义）；取不到路径 → unreviewable（fail-closed，调用方转 ask），绝不放行。
- 反转既有断言：`packages/host-qoder/tests/qoder-adapter.spec.ts` 的 delete_file passthrough 用例改为断言合成请求（`{tool:'bash', command:'rm "C:/a"'}` 形）。
- conformance：qoder 列加 delete_file 场景——合成事件与真 bash `rm "<同路径>"` 事件裁决一致（等价矩阵新行）。
- 清除「不守卫」披露四处：`README.md:145`、`README.zh-CN.md:142`、`docs/usage.md:210`、`docs/troubleshooting.md:35`。

Blocked by: —

Status: done

Acceptance:

- [x] 单测：delete_file payload → `rm "…"` 合成请求；路径缺失 → unreviewable；含空格路径正确包裹、含双引号路径正确转义
- [x] 单测：合成命令过管线与真 bash rm 同流（LLM 必审不静默放行、敏感路径降级、fail-closed）
- [x] conformance 等价场景绿；三门禁（typecheck / test / smoke）全绿
- [x] 四处文档披露清除；`.scratch/0005-host-qoder/spec.md` 的更新注记核对无误
