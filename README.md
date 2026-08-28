# auto-guard

A **command-review safety net for AI coding agents**. Before the host executes a command or reads/writes a file, auto-guard decides **allow / deny / ask** using layered static rules, caches, learned rules, audit history and a one-shot LLM review (DeepSeek by default). It is meant to sit on top of full-access mode: dangerous commands are blocked, routine ones pass in milliseconds, and only genuinely uncertain cases reach the LLM or a human.

One decision engine, three thin host adapters:

- **`@auto-guard/core`** — zero-host-dependency engine: decision pipeline, rules, caches, key hydration, audit, history, learned rules, management operations. Only Node built-ins (ADR-0002).
- **`auto-guard` (packages/host-dsh)** — DeepSeek Harness plugin.
- **`@auto-guard/host-pi`** — Pi Coding Agent extension.
- **`@auto-guard/host-zcode`** — ZCode PreToolUse hook plugin.
- **`@auto-guard/cli`** — unified `auto-guard` management CLI + installer.

All three hosts run the same pipeline with the same defaults and the same rule files; only the integration shell differs (see [Host adapters](#host-adapters)).

## Why

- Full-access mode is productive but scary. Existing LLM-based approval mechanisms (Claude Code auto mode, Codex auto-review) send every command to a model, which is slow and expensive.
- In practice most agent shell commands are safe, simple and highly repetitive. So the review prompt is minimal (no context payload), and anything already adjudicated is served from one of several caches. Measured over short-term daily use, **review cost stays around 1–4% of total spend** and keeps dropping as history accumulates.
- Latency is dominated by the layers, not the LLM: whitelist and cache hits return without any model call, so the guard is effectively invisible.

## Positioning

- **Safety net, not a sandbox.** The guard does not restrict the filesystem; it adjudicates on top of full access and tries not to interrupt normal work. It is not an absolute security boundary — a prompt-injected LLM verdict is possible, which is why high-risk commands are never cached and sensitive file content is never sent for review.
- **Fail-closed everywhere.** Reviewer timeout, missing API key, missing UI — every abnormal path lands on deny or human confirmation, never on silent allow. (An explicit user off-switch always wins; that is the one exception.)
- **Keys never in the repo.** API keys resolve env var → encrypted store (AES-256-GCM, machine-bound) → legacy plaintext field (read-only, never rewritten).

## Decision pipeline (shared by all hosts)

Every shell command passes these layers; first match wins:

```text
command (bash / pwsh)
  → File Tracker          write-then-execute: a freshly written script run immediately
                          is materialized and reviewed (sensitive content is not sent to the LLM)
  → Absolute blacklist    hard-deny, cannot be overridden by cache/learned/LLM
  → Directory-delete      denied once; agent retries with [deletion reason]; a low-reasoning
    review                LLM re-reviews exactly once; non-allow goes to a human
  → Sensitive-path guard  command references .env / .ssh / *.pem … → whole command demoted
                          to LLM (never silently allowed, never cached)
  → Compound commands     split on ; && ||; most restrictive sub-verdict wins; state-changing
                          commands (export, cd, trap, git config …) force whole-command LLM review
  → Pure pipelines        judged as one unit: allowed only when every leaf is deterministically
                          safe; any uncertain leaf sends the whole pipeline to the LLM once
  → Static allowlist      default + user-confirmed rules; token-level guard scan for dangerous
    (+ user-confirmed)    flags (git branch -D, find -exec …); substitution/redirect never static
  → Session cache         LRU keyed by session×workspace×command shape
  → Persistent cache      cross-session, workspace-isolated, TTL by risk (low 30d / medium 7d /
                          high never); LLM denies never enter
  → Template cache        learned approvals match parameter variants (--days 7 ≈ --days 8)
  → History layer         recent low-risk allows of the same skeleton with zero denies → allow
  → LLM fallback          unknown commands; any failure fails closed
```

File operations (`write` / `edit` / `read`) are gated by the sensitive-path list only: a hit is ask-only and the content never leaves the machine; everything else passes. Commands outside guard scope pass through untouched.

Two memory behaviors sit on top of the pipeline:

- **Guard Memory** — an LLM deny is never cached; if the same command reappears, it is escalated to a human ask instead of being silently re-judged.
- **Four-state ask** (hosts whose ask UI supports it) — allow once / allow this session / deny with reason / deny this session.

Each decision carries a source tag you can see in notifications: `[Allowlist]`, `[LLM]`, `[Blacklist]`, `[Session cache]`, `[Persistent cache]`, `[Learned]`, `[History]`, `[Delete review]`, `[Write-then-execute]`, `[Sensitive path]`, `[Pre-authorized]`.

### Command classification

| Category | Behavior | Examples | Cached? |
|---|---|---|---|
| Static allowlist | direct allow | `ls`, `git status`, `git diff`, `git commit` | no |
| Absolute blacklist | direct deny | `rm -rf /`, `mkfs`, `dd of=/dev/...` | no |
| Directory-delete review | agent reason + one low-reasoning LLM re-review | `rm -rf ./dist`, `Remove-Item -Recurse` | no |
| User-confirmed | user-declared "always allow" | `git push` | no |
| Cacheable | LLM approval cached by TTL | `npm run build`, `npm test` | yes |
| Always-review | LLM every time; allow gets short session cache | `npm install`, `Invoke-Expression`, `curl \| bash` | session-only, 30 min |
| Unknown | LLM decides; low/medium allow becomes cacheable | everything else | low/medium yes |

### Caching, learning, audit

- **Learned rules** — an offline deterministic analysis of the audit DB distills repeatedly-safe commands into cacheable templates (`learned-rules.json`, lowest priority, never static-allow; every write is backed up and rollbackable). Runs manually or automatically every 15 days; off by default.
- **Guard stats** — in-session counters per layer (LLM calls, cache/rule/history hits). Memory only, reset each session.
- **Audit store** — optional (off by default) local encrypted SQLite of shell-command verdicts: redacted before write, never records file tools or execution output. It is the data source for the history layer and rule learning.

## Host adapters

Each adapter only translates host events into `GuardRequest` and decisions back into the host's decision protocol; all adjudication lives in core. Each host has its own config root — `~/.dsh/auto-guard/`, `~/.pi/auto-guard/`, `~/.zcode/auto-guard/` — with zero sharing between hosts and zero migration on upgrade.

### `auto-guard` (packages/host-dsh) — DeepSeek Harness plugin

- Hooks `tools/pre-execute`; blacklist verdicts additionally register a monotonic `ctx.tools.guard()` veto that the LLM cannot override.
- **On/off = the `auto-guard` permission preset** (`danger-full-access` + ask) in the dialog's permission selector. That is the only switch; nothing else persists an enabled flag.
- Configuration lives in the `auto-guard:` namespace of `~/.dsh/settings.yaml`, edited through a dedicated settings page (grouped fields, masked key display) plus maintenance buttons — analyze now / view rules / rollback learned rules / status / trim audit / export plaintext audit DB / create new audit DB / stats — locally and via **Typert remote**. No slash commands.
- Empty `apiBase` routes review requests through the DSH built-in provider system (`provider`, `reasoningEffort`, `fallbackProvider`); a non-empty value talks to an OpenAI-compatible endpoint directly.
- Audit store: **SQLCipher full-database encryption** (password required to enable; migrate/rekey/export/new-DB supported).
- Packaging: dsh plugin (`client.js` settings UI + `typert/` + `cordis.patch.yml`).

### `@auto-guard/host-pi` — Pi Coding Agent extension

- Intercepts every `tool_call` (bash / pwsh / write / edit / read) **and every `user_bash` command the user types** (with input rewrite for operations).
- **Four-state ask dialog** (allow once / allow this session / deny with reason / deny this session) via Pi's native UI; directory-delete confirmation uses `ctx.ui.input` with a fail-closed headless marker.
- Richest slash-command surface: `/guard` (on/off/status/stats), `/guard-set` (reload / set-key / show-key / clear-key / set-api wizard), `/guard-examine` (audit), `/guard-optimize` (learning + history layer).
- A footer status bar shows live guard state: `🛡️ on` · `⚠ no-key` (fail-closed) · `审查✗` (last review failed) · `off`.
- Notification routing: allow is UI-only (`ctx.ui.notify`); deny/ask also enter the model context via `sendMessage` so the agent knows it was blocked. Rule-based allows stay page-only even if configured otherwise.
- Audit store: SQLCipher, falling back to the Light store (field-level AES-GCM) when SQLCipher is unavailable.
- Packaging: pi extension; jiti runs the TypeScript entry directly.

### `@auto-guard/host-zcode` — ZCode PreToolUse hook plugin

- One process per tool call: all session state (session cache, write-then-execute tracking, pending delete reviews, pending denies) lives on disk under `~/.zcode/auto-guard/sessions/<sid>/`, so the one-shot process model loses nothing.
- Verdict returns as stdout JSON `permissionDecision`; allow is silence. Ask is **delegated to ZCode's native permission prompt** — the guard builds no UI of its own. Without an API key it fails closed: non-whitelisted commands are denied, everything else keeps working.
- Positioning: the client runs PreToolUse hooks ahead of permission-mode checks and a hook deny blocks unconditionally — the permission dropdown still controls native prompting, auto-guard adjudicates independently before it.
- No push notification channel, so feedback is **pull-based decision history**: a ring-buffer JSONL of recent verdicts with hit details, read via `guard recent`.
- Slash commands (`/guard`, `/guard-examine`, …) are `commands/*.md` files that teach the model to call the bundled CLI; API keys are accepted only through `set-key` in a real terminal with echo disabled, stored AES-256-GCM in `api-key.json` — never as CLI arguments or chat input.
- Audit store: Light (node:sqlite + field-level AES-GCM).
- Packaging: plugin manifest + `hooks/hooks.json` + prebuilt `dist/`; a SessionStart hook re-reads config.

## Install

Three-minute quickstart with the unified installer (Node ≥ 20, zero external deps):

```bash
auto-guard init        # detects installed hosts, checkbox multi-select, writes integrations
# … or non-interactive: auto-guard init --host pi,zcode --yes
```

Interactive `init` leads with the block-letter banner (bilingual tagline) and a bilingual prompt (请选择语言 / Select language — `1` 中文, `2` English). The choice is persisted to the machine default (`~/.auto-guard/config.json`) immediately — later inits never re-ask and `remove` keeps it. The whole product is bilingual (installer, management CLI, engine messages, host-session prompts, LLM decision reasons); resolution everywhere: `AUTO_GUARD_LANG` env → per-host `set lang <zh|en>` → machine default → zh fallback. The `[删除理由]` marker is protocol and stays Chinese.

Every write is shown as a diff first, backs the target up to `*.auto-guard.bak`, and is verified after writing — re-running `init` is idempotent (a block-letter banner with a top-to-bottom cyan→blue→violet gradient and an ANSI-Shadow-style double-line extrusion heads the run on interactive terminals; `NO_COLOR` degrades it to plain text). Start a new session in each installed host afterwards (ZCode hooks have no hot reload) and check `auto-guard guard status`, which renders a status overview of every installed host. `auto-guard list` shows detection evidence and integration status; `auto-guard remove [--host …]` uninstalls (restores backups; your `~/.<host>/auto-guard/` data is kept). Details: [usage manual](docs/usage.md) · [CLI guide](docs/cli.md) · [troubleshooting](docs/troubleshooting.md).

Each host's native channel stays fully supported and coexists with the installer:

- **ZCode**: install the plugin (manifest + hooks live in `packages/host-zcode`); `dist/` is prebuilt.
- **Pi**: register the extension (`packages/host-pi/package.json` → `"pi": {"extensions": ["./src/index.ts"]}`).
- **DSH**: install the plugin (`packages/host-dsh`); the `auto-guard` permission preset turns the guard on.

Adding a fourth host means one profile plus one adapter package — no installer changes ([guide](docs/new-host.md)).

## Configuration

Everything is configured from the command line or by editing the JSON in a config root; **each host has its own root and nothing is shared** (keys, audit, learned rules are per host). Management commands pick a host via `--config-root <path>` → `AUTO_GUARD_CONFIG_ROOT` env → auto-detect (`~/.zcode` / `~/.pi` / `~/.dsh`, first existing). With several hosts installed, auto-detect lands on only one of them — target the others explicitly:

```bash
auto-guard set set-key --config-root ~/.pi/auto-guard   # key for Pi
auto-guard examine on  --config-root ~/.dsh/auto-guard  # audit for dsh
auto-guard guard status                                # no flag = overview of all hosts
```

Full command surface: [usage manual §3](docs/usage.md).

Single superset schema; every host seeds the same keys into its own config root (paths unchanged across all generations — upgrading is zero-migration):

| Key | Default | Notes |
|---|---|---|
| `enabled` | `true` | master switch (pi/zcode); dsh uses the permission preset instead |
| `lang` | *(unset)* | output language (`set lang zh\|en`); unset = machine default, then zh |
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
| `examineEnabled` | `false` | audit log (off by default) |
| `historyEnabled` / `historyDays` | `false` / `60` | runtime history layer over the audit log |
| `autoAnalyzeEnabled` / thresholds | `false` / conservative | learned cacheable-rule generation |
| dsh-only | — | `provider`, `reasoningEffort`, `fallbackProvider`, `apiKeyMasked`, `auditPassword` (secret role) |

Path-valued keys (`rulesPath`, `defaultRulesPath`, `cachePath`, `auditDbPath`, …) all default to files inside the host config root.

### Rules files

Rules are eight glob-style, case-insensitive pattern lists: `staticAllow`, `hardDeny`, `directoryDelete`, `userConfirmed`, `cacheable`, `alwaysReview`, `staticAllowGuards`, `sensitivePaths`. On first run the engine provisions an editable `defaults.json` (copy of the shipped rules) into the config root; your `rules.json` lists only deltas — missing fields are merged back in. Example:

```json
{
  "version": 1,
  "staticAllow": [
    { "pattern": "git log", "reason": "Read-only git log" }
  ]
}
```

## Coming from dsh-auto-guard / pi-auto-guard / zcode-auto-guard

auto-guard is the continuation of three copy-port generations (`dsh-auto-guard` 0.2.0 → `pi-auto-guard` 0.1.3 → `zcode-auto-guard` 0.1.0), now one repo so cross-host fixes land in one commit. Migrating: uninstall the old plugin, install the unified package through the same host channel (or the installer) — config roots, file names and schema keys are unchanged, so rules, caches, learned rules and audit data keep working in place. Behavior deltas: [differences](docs/differences.md).

## Development

```bash
pnpm install
pnpm -r typecheck && pnpm -r test   # per-package vitest suites
pnpm smoke                          # per-host smoke scripts
```

`GuardService.decide(GuardRequest)` is the single testable seam; `packages/conformance` pins identical decision semantics across all three bootstrap styles.

License: MIT.
