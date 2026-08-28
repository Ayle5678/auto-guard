# auto-guard

A unified command-review guard for AI coding agents: before the host executes a command or reads/writes a file, auto-guard decides **allow / deny / ask** using layered static rules, caches, learned rules, audit history and an optional LLM review. One decision engine, three thin host adapters.

- **`@auto-guard/core`** — the zero-host-dependency decision engine (decision pipeline, rules, caches, key hydration, audit, history, learned rules, management operations).
- **`@auto-guard/host-pi`** — Pi Coding Agent extension (`tool_call` / `user_bash`, four-state ask).
- **`@auto-guard/host-zcode`** — ZCode PreToolUse hook plugin (one process per call, disk session state, decision history).
- **`@auto-guard/host-dsh`** — DeepSeek Harness plugin (`tools/pre-execute`, permission-preset switch, SQLCipher audit, settings UI + Typert remote).
- **`@auto-guard/cli`** — unified `auto-guard` management CLI and (SPEC 0002) installer.

This monorepo merges three copy-port predecessors: `dsh-auto-guard` 0.2.0 → `pi-auto-guard` 0.1.3 → `zcode-auto-guard` 0.1.0. Cross-host fixes are now one commit; each host keeps its native packaging and distribution channel (see [differences](docs/differences.md)).

## Host matrix

| Dimension | host-dsh | host-pi | host-zcode |
|---|---|---|---|
| Integration event | `tools/pre-execute` + monotonic guard | `tool_call` + `user_bash` | PreToolUse hook (one process per call) + SessionStart |
| Decision protocol | PreToolDecision deny/ask + `next()` | `{block, reason}` / input rewrite | stdout JSON `permissionDecision`; allow = silence |
| Ask style | host one-shot approval | four-state dialog | delegated to native permission prompt |
| On/off switch | permission preset (`auto-guard`) — the only switch | `/guard on\|off` + `config.enabled` | `config.enabled` (`/guard off` always wins) |
| Session state | memory | memory | disk (`sessions/<sid>/`) |
| Notifications | page events / context inject | `ctx.ui.notify` / `sendMessage` | pull-based decision history (`guard recent`) |
| Config root | `~/.dsh/auto-guard/` | `~/.pi/auto-guard/` | `~/.zcode/auto-guard/` |
| Command surface | settings UI + Typert remote (no slash commands) | `/guard` `/guard-set` `/guard-examine` `/guard-optimize` | `commands/*.md` teaching the model to call the CLI |
| Packaging | dsh plugin (client.js + typert + cordis.patch.yml) | pi extensions (jiti runs TS directly) | plugin manifest + hooks.json + prebuilt dist |
| Audit store | SQLCipher (full-db encryption) | SQLCipher (falls back to Light) | Light (node:sqlite + field-level AES-GCM) |

## Install

Use each host's native channel (all still fully supported):

- **ZCode**: install the plugin (manifest + hooks live in `packages/host-zcode`); `dist/` is prebuilt.
- **Pi**: register the extension (`packages/host-pi/package.json` → `"pi": {"extensions": ["./src/index.ts"]}`); Pi's jiti runs the TypeScript directly.
- **DSH**: install the plugin (`packages/host-dsh`); the `auto-guard` permission preset turns the guard on.

Or run the unified installer from SPEC 0002: `npx @auto-guard/cli init` (detects installed hosts, writes integrations idempotently, `auto-guard remove` uninstalls).

## Configuration

Single superset schema; every host seeds the same keys into its own config root (paths unchanged from the predecessors — upgrading is zero-migration). Key defaults (`timeoutMs` 8000, notify routing allow=page / deny=ask=context, TTLs low 30d / medium 7d / high never):

| Key | Default | Notes |
|---|---|---|
| `enabled` | `true` | master switch (pi/zcode); dsh uses the permission preset instead |
| `apiBase` | `https://api.deepseek.com` | OpenAI-compatible review endpoint (dsh: empty = provider route) |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | env var wins over stored keys |
| `model` / `fallbackModel` | `deepseek-v4-flash` | review model, fallback model |
| `timeoutMs` | `8000` | per-request budget; fail-closed on timeout |
| `onTimeout` | `deny` | service-level fallback policy |
| `headlessMode` | `deny` | ask fallback without UI (pi/dsh capability layers) |
| `notifyAllow` / `notifyDeny` / `notifyAsk` | `page` / `context` / `context` | routing per decision kind |
| `lowRiskTtlDays` / `mediumRiskTtlDays` | `30` / `7` | persistent-cache TTL (high risk never cached) |
| `sessionCacheSize` | `256` | LRU entries |
| `alwaysReviewCacheTtlMinutes` | `30` | short-lived session TTL for always-review allows |
| `fileTrackerDefault` / `fileTrackerWindowSec` | `ask` / `5` | write-then-execute tracker |
| `examineEnabled` | `false` | experimental audit log (off by default) |
| `historyEnabled` / `historyDays` | `false` / `60` | runtime history layer over the audit log |
| `autoAnalyzeEnabled` / thresholds | `false` / conservative | learned cacheable-rule generation |
| dsh-only | — | `provider`, `reasoningEffort`, `fallbackProvider`, `apiKeyMasked`, `auditPassword` (secret role) |

Path-valued keys (`rulesPath`, `defaultRulesPath`, `cachePath`, `auditDbPath`, `learnedRulesPath`, `learnedBackupPath`, `analyzeStatePath`, `templateCachePath`) all default to files inside the host config root.

API keys resolve in priority order: **env var → encrypted store (`api-key.json`, AES-256-GCM machine-bound) → legacy plaintext field (read-only, never rewritten)**.

## Migrating from dsh-auto-guard / pi-auto-guard / zcode-auto-guard

1. Uninstall the old plugin/extension from the host.
2. Install the unified package through the same host's channel (or the installer).
3. Nothing else. Config roots, file names and schema keys are unchanged, so rules, caches, learned rules and audit data keep working in place. See [differences](docs/differences.md) for the behavior deltas you may notice.

## Development

```bash
pnpm install
pnpm -r typecheck && pnpm -r test   # per-package vitest suites
pnpm smoke                          # per-host smoke scripts
```

`GuardService.decide(GuardRequest)` is the single testable seam; `packages/conformance` pins identical decision semantics across all three bootstrap styles.

License: MIT.
