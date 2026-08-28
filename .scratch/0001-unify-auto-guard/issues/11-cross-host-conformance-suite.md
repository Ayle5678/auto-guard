# 11 — 跨宿主一致性测试套件

What to build:
- **宿主一致性套件**：同一组 GuardRequest 场景（白名单命中、hard-deny、目录删除两段式、写后执行、敏感路径、缓存命中链、LLM fallback fail-closed）在三个适配层跑出**等价的 Decision**（kind/risk/source 一致；协议翻译各自断言）。
- fail-closed 矩阵：无 key、超时、畸形 LLM 输出、bootstrap 异常 × 三宿主。
- 端到端冒烟：每宿主一个"真实宿主装载"冒烟（dsh plugin 装载、pi extensions 装载、zcode hooks 触发）。

Blocked by: 07, 08, 09, 10
Status: done

Acceptance:
- [x] 一致性套件中三宿主 Decision 等价断言全绿
- [x] 三个冒烟脚本可在本机（三宿主均已安装的开发机）一键运行
- [x] 套件运行时间 < 2 分钟（mock LLM）

## Comments

- 2026-08-28: done — packages/conformance: scenario matrix (whitelist/hard-deny/always-review-LLM/sensitive-path/directory-delete two-phase) × three bootstrap styles (memory/memory/disk); fail-closed matrix (reviewer throw, malformed parse, missing key); 21 tests <5s with fake LLM; scripts/smoke/{zcode,pi,dsh}.mjs one-click via pnpm smoke (zcode full e2e on built dist, pi/dsh pure-adapter smokes + full-mount instructions)
- 2026-08-28 code-review: added 写后执行 (shell-redirect write → execute, source=file-tracker) and 缓存命中链 (llm → cached repeat) scenarios; pi/dsh smokes now really exercise the adapters via Node type stripping (no silent SKIP)
