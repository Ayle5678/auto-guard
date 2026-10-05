# 降噪与删除分级观测口径（SPEC 0027 / 0028 验收）

一次性统计口径，可对任一宿主的 `decision-history.jsonl` 重跑（不新增长驻工具）。上线后 14 天各跑一次，对照下表基线。

## 指标一：llm-ask 率（SPEC 0027 验收：30 天窗口从基线降到 ≤1.2%）

分母为 **LLM 层裁决数**（`lastDecisionSource === "llm"`），分子为其中 `ask`——即"评审员想问人"的占比，与 2026-10-05 调研同口径。

```bash
node -e "
const fs = require('fs')
const entries = fs.readFileSync('<config-root>/auto-guard/decision-history.jsonl', 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const newest = Math.max(...entries.map((e) => Date.parse(e.lastRunAt || 0)))
const win = entries.filter((e) => Date.parse(e.lastRunAt || 0) >= newest - 30 * 24 * 3600 * 1000 && e.lastDecisionKind)
const llm = win.filter((e) => e.lastDecisionSource === 'llm')
const llmAsk = llm.filter((e) => e.lastDecisionKind === 'ask')
console.log('llm:', llm.length, 'llm-ask:', llmAsk.length,
  'rate-in-llm:', (100 * llmAsk.length / Math.max(1, llm.length)).toFixed(2) + '%')
"
```

## 指标二：删除流协议往返占比（SPEC 0028 验收：从 ~64% 降一半以上，即 ≤32%）

分子 = `lastDecisionSource === "directory-delete"` 且 `lastDetail` 含首击要理由（`目录删除需要理由`）或理由未接上（`未找到 [删除理由]`）的条数。分母 = 删除流全部决策：`directory-delete` 来源条数 **加上** 轻量级处置条数（其决策以 `llm` 来源落库、`lastDetail` 以「删除分级·轻量」开头）；文件回落条数走普通评审且无标记，不入分母（它本就不是删除复核流）。轻量/严格级生效后，原协议往返中的可再生缓存与小临时目录段不再出现在分子里；严格级收口的 ask 在 `lastDetail` 中可由「删除分级·严格 / 人工确认」辨认。

```bash
node -e "
const fs = require('fs')
const entries = fs.readFileSync('<config-root>/auto-guard/decision-history.jsonl', 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const newest = Math.max(...entries.map((e) => Date.parse(e.lastRunAt || 0)))
const win = entries.filter((e) => Date.parse(e.lastRunAt || 0) >= newest - 30 * 24 * 3600 * 1000 && e.lastDecisionKind)
const dd = win.filter((e) => e.lastDecisionSource === 'directory-delete' || (e.lastDetail || '').includes('删除分级·轻量'))
const roundTrip = dd.filter((e) => /目录删除需要理由|未找到 \[删除理由\]/.test(e.lastDetail || '')).length
console.log('delete-flow:', dd.length, 'protocol-round-trips:', roundTrip,
  'share:', (100 * roundTrip / Math.max(1, dd.length)).toFixed(1) + '%')
"
```

## 基线（2026-10-05，zcode 宿主，30 天窗口，上线前）

| 指标 | 数值 |
|---|---|
| LLM 层裁决 | 10,231 |
| llm-ask | 202（LLM 层内 1.97%；当日晨间调研为 2.5%，口径一致、时点不同） |
| 删除流决策 | 141 |
| 协议往返 | 90（首击要理由 79 + 理由未接上 11）＝ 63.8% |

验收线：14 天后 llm-ask ≤1.2%（LLM 层内口径）；协议往返占比 ≤32%（降一半以上）；严格级决策 100% 带人工确认（`人工确认` 字样可在 decision-history 详情中核对）。
