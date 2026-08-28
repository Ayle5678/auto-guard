# Behavior differences vs the three predecessors

For users checking what changed after upgrading from `dsh-auto-guard` 0.2.0, `pi-auto-guard` 0.1.3 or `zcode-auto-guard` 0.1.0. Config roots, file names and schema keys are unchanged; the items below are the only behavioral deltas ("take the newest detail" policy from SPEC 0001).

## All hosts

- `timeoutMs` default is **8000** (zcode's value; pi shipped 3000). Fail-closed on timeout is unchanged.
- Pipeline leaf: deterministic allow for pipeline leaves (zcode ADR-0018 semantics) — pipelines whose leaves are all provably safe no longer go to the LLM.
- Learned rules: **cacheable-only** + `NON_LEARNABLE_CACHEABLE` first-command blacklist + load-time filtering/dedup (dsh 0.2.0 hardening). Learned rules never produce static-allow entries.
- Defaults `rules.json` is the union of the three predecessor rule files (identical sets — 114 static-allow / 6 hard-deny / 13 directory-delete / 1 user-confirmed / 4 cacheable / 71 always-review / 10 static-allow-guards / 15 sensitive-paths; zero conflicts).
- Review prompt, JSON parsing (tolerant: missing risk defaults to medium) and the timeout budget (`high` reasoning gets ≥30s) are core-owned; hosts cannot fork them.

## Coming from dsh-auto-guard 0.2.0

- Audit stays SQLCipher (same `better-sqlite3-multiple-ciphers`, same migration/rekey/export/createNew semantics).
- The plugin name is `auto-guard`; the remote namespace stays `autoGuard`. The permission preset remains the only on/off switch (`enabled` is never persisted on dsh).
- Set-key wizard unchanged (TTY, three steps).

## Coming from pi-auto-guard 0.1.3

- **API key is now stored encrypted** (`~/.pi/auto-guard/api-key.json`, AES-256-GCM machine-bound). Your legacy plaintext `config.apiKey` is still honored read-only and never rewritten; run `/guard-set set-key` to move it into the encrypted store.
- `/guard-set clear-key` clears only the encrypted store; the legacy plaintext field stays as-is.
- Everything else (four-state ask, deny-reason flow, directory-delete flow, `user_bash` operations rewrite) is behavior-identical.

## Coming from zcode-auto-guard 0.1.0

- Audit store is unchanged (Light: node:sqlite + field-level AES-GCM).
- The plugin id becomes `auto-guard`; `guard-set.md` no longer contains a hardcoded absolute path (uses `${ZCODE_PLUGIN_ROOT}`).
- Decision history, `guard recent`, status file, fail-closed ladder — unchanged.

## Installer (SPEC 0002)

`auto-guard init` / `auto-guard remove` automate host wiring (backup before write, idempotent, never touches files outside the profiles). Native install channels remain the source of truth; the installer is a shortcut.
