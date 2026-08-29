# 0008 — Issue 01：review-loop 转正 + 触网口径修正

What to build:
- 按 spec 研究方向落地：转正脚本（1）、双传输 mock（2）、`--isolate` 可行性（3）、CI 结论（4）、口径头注（5）。
- 参考实现要点（原脚本已删，凭据只剩这些结论）：命令全局唯一（时间戳-i-随机数）；每 run spawnSync 真实 `dist/hook-cli.js`；触网断言读 `<config-root>/status.json` 的 `lastDecisionSource === 'llm'`；每次 run 的 stdout/stderr/exit code 落盘，崩溃样本以 `Assertion failed` + 非零退出码双条件判定。

Blocked by: 无
Status: done

Acceptance:
- [x] 30× mock（http 与 https 两分支）30/30 触网、0 崩溃
- [x] 崩溃率分母只含触网样本，缓存短路被显式报告
- [x] live `--isolate` 落地或不可行结论落档
- [x] CI 接入 mock 模式或理由落档

## Comments

- 2026-08-29: 建票 —— 原脚本完成使命后清理（grill-log Round 7）；本票把它作为正式回归工具重建并修正统计口径
- 2026-08-29: 完成。落地为 `packages/conformance/review-loop.mjs`（+ `review-loop-mock-server.mjs`、`fixtures/tls/` 自签 CA/证书），根脚本 `pnpm review-loop`。
  - 双传输 mock：默认 plain http，`--https` 自签 TLS（子进程 `NODE_EXTRA_CA_CERTS` 指 fixture CA）；mock 服务跑在独立子进程，端口/请求数经 state 文件交回（部分沙箱策略下 spawn 子进程连不到父进程自身的监听，兄弟进程可达——实测确认）。
  - 口径：命令 `alias ag-loop-<时间戳>-<i>-<随机>=…` 全局唯一（`alias` 命中高危 state-changing → 整条直通 llmDecision，无缓存路径）；触网 = `lastDecisionSource === 'llm'` 且 `reviewerLastFailed` 非真；缓存/静态短路单列报告不计分母；崩溃 = 非零退出 + stderr `Assertion failed` 双条件；其余非零退出/无 status 记 anomaly；报告含 mock server 实收请求数交叉核对与 min/max/avg 耗时。
  - live `--isolate` 落地：临时 HOME + 真实 config 剥离 `apiKey`/`apiKeyMasked` 后复制，存储密钥经 core `loadApiKey`/`saveApiKey` 重加密注入（env 密钥则直接继承 env，无需注入）；`--check-isolate` 离线自检（不烧配额）本机实跑 OK。
  - CI 结论：本仓库现无 CI 流水线；mock 模式（http+https 各一轮）可作传输层回归接入（`pnpm review-loop --times N`），秒级/次、零外部依赖；`--live` 烧真实配额+网络抖动，永不进 CI。结论写在脚本头注与 `packages/conformance/README.md`。
  - 门禁：`pnpm -r typecheck` / `pnpm -r test` / `pnpm smoke` 全绿（与工作区在途的 Round 7 未提交改动一起验证）。

30× mock http 实跑输出：

```
$ pnpm review-loop --times 30
[review-loop] mock http://127.0.0.1:2625  host=zcode  times=30
────────────────────────────────────────────────────────────────────────
review-loop  mode=mock/http  host=zcode  times=30
crashes: 0/30  (llm-path: 30/30 触网样本计入分母)
缓存/静态短路（不计入分母）: 0
reviewer 失败（请求未成功）: 0
anomaly（非零退出/无 status）: 0
慢样本(>15000ms, 仅 mock): 0
mock server 收到请求数: 30
耗时 ms: min=832 max=1064 avg=930
结论: GREEN
artifacts: C:\Users\Administrator\AppData\Local\Temp\ag-review-loop-2026-08-29T16-27-01-703Z-0a7e7e
EXIT=0
```

30× mock https 实跑输出（自签 TLS + NODE_EXTRA_CA_CERTS）：

```
$ pnpm review-loop --times 30 --https
[review-loop] mock https://127.0.0.1:6739  host=zcode  times=30
────────────────────────────────────────────────────────────────────────
review-loop  mode=mock/https  host=zcode  times=30
crashes: 0/30  (llm-path: 30/30 触网样本计入分母)
缓存/静态短路（不计入分母）: 0
reviewer 失败（请求未成功）: 0
anomaly（非零退出/无 status）: 0
慢样本(>15000ms, 仅 mock): 0
mock server 收到请求数: 30
耗时 ms: min=842 max=1109 avg=945
结论: GREEN
artifacts: C:\Users\Administrator\AppData\Local\Temp\ag-review-loop-2026-08-29T16-31-17-028Z-e0a0e0
EXIT=0
```

live `--isolate` 离线自检（不发起 LLM 请求）：

```
$ node packages/conformance/review-loop.mjs --live --check-isolate
[review-loop] live --isolate 自检 OK  host=zcode  密钥注入+回读成功（未打印内容）  临时 HOME 已隔离
EXIT=0
```
