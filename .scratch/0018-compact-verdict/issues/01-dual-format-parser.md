# 01 — 解析器双格式：紧凑裁决码优先、三键 JSON 回退

**What to build:** 重写 `packages/core/src/review-parse.ts`：`parseReviewJson` 先按紧凑码解析（`^([ABC])([123])` 大小写不敏感，码后可接英文/全角冒号 + 理由；容忍 code fence 与空白；理由可缺省回退 `''`），不匹配再走既有三键 JSON 提取分支。导出函数名与返回类型（`LlmReviewResult | undefined`）不变，7 个调用点零改动。非法输入（如 `D4`、既非码也非 JSON）维持返回 undefined → 上层 fail-closed。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `A1` → allow/low/reason=''；`B3: <句子>` → deny/high/reason=<句子>；`C2：<全角冒号>` → ask/medium
- [x] 小写 `a1`、fence 包裹（```A2```）、码后空白均正确解析
- [x] `B3:`（冒号后无理由）不炸，reason=''
- [x] 既有全部 JSON 用例（含 fence、前后缀包裹、非法 decision）原样通过——回退分支行为逐字节不变
- [x] `D4`、`A0`、空串返回 undefined
- [x] 包级 typecheck + test 全绿

## Comments

- 2026-09-21: 建票 —— SPEC 0018 / ADR-0020。
- 2026-09-21: done。`review-parse.ts` 拆 `parseVerdictCode`（正则 `/^([abc])([123])\s*(?:[:：]\s*(.*\S)?)?\s*[.。]?\s*$/i`，容忍大小写/fence/半全角冒号/裸冒号/尾句点）+ `parseLegacyJson`（原函数体原样），`parseReviewJson` 码优先、JSON 回退。正则逐输入 0ms（无回溯风险）。用例落 guard-service.spec 'LLM review parsing' 三组。
