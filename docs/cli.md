# Unified CLI (`auto-guard`)

> 完整中文使用手册（含安装器交互流程与示例输出）：[usage.md](usage.md)。
> 全屏交互版：`@auto-guard/tui`（`auto-guard-tui`，SPEC 0009）——同一命令面的 TUI 控制台，见 [usage.md §6](usage.md#6-tui-控制台auto-guard-tui)。

The management CLI is a thin terminal shell over the shared core operations layer. All subcommands work identically against any host's config root. The installer (SPEC 0002, `init` / `list` / `remove`) runs before config-root resolution so it works on machines where no auto-guard config exists yet.

```
auto-guard [--config-root <path>] <group> <action> [args]                             # management
auto-guard <init|list|remove> [--host dsh,pi,zcode,claude,opencode,qoder] [--yes] [--lang zh|en] # installer
```

## Installer (SPEC 0002)

| Command | Purpose |
|---|---|
| `auto-guard init` | Detect installed hosts, interactive multi-select, write integrations (backup + diff preview before every write). |
| `auto-guard init --host pi,zcode --yes` | Non-interactive install; `--yes` skips the diff confirmation (backup is still mandatory). |
| `auto-guard list` | Show detection evidence + integration status per host and the next step. |
| `auto-guard remove [--host …]` | Uninstall: restore from `*.auto-guard.bak` when present, otherwise remove auto-guard entries structurally. Guard data roots are kept. |

Common flags: `--host <dsh,pi,zcode,claude,opencode,qoder>` (repeatable values in one list), `--yes`, `--banner` (force the init banner outside a TTY), `--home <path>` (override HOME, mainly for tests), `--lang <zh|en>` (installer output language). `--config-root` is accepted and ignored by the installer — the guard config root belongs to the guard, not the installer (spec 0002). Exit codes: 0 ok, 2 failed/undetected/unknown host.

Language: the whole product (installer + management CLI + engine messages + host prompts) speaks Chinese and English. Resolution is the same four layers everywhere (ADR-0011): `AUTO_GUARD_LANG` env (one-shot override) → per-host `config.lang` (`auto-guard set lang en|zh`) → machine default `~/.auto-guard/config.json` → `zh` fallback. The installer chain additionally leads with `--lang` and ends with the interactive prompt: `--lang` → `AUTO_GUARD_LANG` → machine default → bilingual "请选择语言 / Select language" prompt (init on a TTY, only when no default is remembered) → `zh`. The prompt choice and `--lang` are both persisted to the machine default immediately — later inits never re-ask, `remove` keeps the preference. LLM decision reasons follow the setting; the `[删除理由]` marker is protocol and stays Chinese. ZCode hook spinner text (`statusMessage`) is written in the install-time language and changes only on reinstall.

Idempotent: re-running `init` detects already-integrated entries and skips them; existing backups are never overwritten. ZCode, Claude Code and Qoder hooks have no hot reload — start a new session in those hosts after installing.

`--config-root` resolution order (management commands): flag → `AUTO_GUARD_CONFIG_ROOT` env → auto-detect (`~/.zcode` → `~/.claude` → `~/.config/opencode` → `~/.pi` → `~/.dsh`, first existing).

Each host keeps its own config root (`~/.dsh|~/.pi|~/.zcode/auto-guard/`) — keys, audit and learned rules are per host. When several hosts are installed, auto-detect always lands on one of them, so configure the others explicitly:

```bash
auto-guard set set-key --config-root ~/.pi/auto-guard   # key for Pi
auto-guard examine on  --config-root ~/.dsh/auto-guard  # audit for dsh
export AUTO_GUARD_CONFIG_ROOT=~/.pi/auto-guard          # or pin the whole session
```

`guard status` has two views: with an explicitly selected root it renders that root only; when the root is auto-detected it aggregates every installed host — seeded roots in full, installed-but-never-run hosts as an "unseeded" hint, absent hosts skipped. Both views show the effective language (`lang : en` — one line per root in the aggregate view, so per-host choices are visible). It is read-only and never creates config. All other management commands act on the single resolved root.

| Group | Actions |
|---|---|
| `guard` | `on` `off` `status` `recent [n]` `stats` `report [days]`（default 7：按裁决种类与决策来源统计近 N 天审计记录，需 examine on）`ping` |
| `set` | `set-key`（three-step TTY wizard, echo disabled）`show-key` `clear-key` `set-api base <url>` / `model <id>` / `reset` `lang <zh\|en>`（per-host output language; receipt in the new language）`history on\|off` `reload` |
| `examine` | `on` `off` `status` `clear-old`（30d）`clear-all` |
| `optimize` | `status` `analyze` `list` `rollback` |

Windows discipline: the process exits naturally (`process.exitCode`, never `process.exit`) so libuv can drain handles after fetch calls; `set set-key` requires a real TTY; exit codes are 0 (ok) or 2 (refused/failed).

Secrets: API keys are never accepted as argv (shell history). `set set-key` reads the key with echo disabled and stores it AES-GCM-encrypted in the config root's `api-key.json`.

## PowerShell alias

Add to your `$PROFILE`:

```powershell
Set-Alias auto-guard "$env:USERPROFILE\.auto-guard\bin\auto-guard.cmd"
```

or run via npx: `npx @auto-guard/cli guard status --config-root "$env:USERPROFILE\.zcode\auto-guard"`.
