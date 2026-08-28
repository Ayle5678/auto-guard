# Unified CLI (`auto-guard`)

> 完整中文使用手册（含安装器交互流程与示例输出）：[usage.md](usage.md)。

The management CLI is a thin terminal shell over the shared core operations layer. All subcommands work identically against any host's config root. The installer (SPEC 0002, `init` / `list` / `remove`) runs before config-root resolution so it works on machines where no auto-guard config exists yet.

```
auto-guard [--config-root <path>] <group> <action> [args]   # management
auto-guard <init|list|remove> [--host dsh,pi,zcode] [--yes] # installer
```

## Installer (SPEC 0002)

| Command | Purpose |
|---|---|
| `auto-guard init` | Detect installed hosts, interactive multi-select, write integrations (backup + diff preview before every write). |
| `auto-guard init --host pi,zcode --yes` | Non-interactive install; `--yes` skips the diff confirmation (backup is still mandatory). |
| `auto-guard list` | Show detection evidence + integration status per host and the next step. |
| `auto-guard remove [--host …]` | Uninstall: restore from `*.auto-guard.bak` when present, otherwise remove auto-guard entries structurally. Guard data roots are kept. |

Common flags: `--host <dsh,pi,zcode>` (repeatable values in one list), `--yes`, `--home <path>` (override HOME, mainly for tests). `--config-root` is accepted and ignored by the installer — the guard config root belongs to the guard, not the installer (spec 0002). Exit codes: 0 ok, 2 failed/undetected/unknown host.

Idempotent: re-running `init` detects already-integrated entries and skips them; existing backups are never overwritten. ZCode hooks have no hot reload — start a new ZCode session after installing.

`--config-root` resolution order (management commands): flag → `AUTO_GUARD_CONFIG_ROOT` env → auto-detect (`~/.zcode` / `~/.pi` / `~/.dsh`, first existing).

| Group | Actions |
|---|---|
| `guard` | `on` `off` `status` `recent [n]` `stats` `ping` |
| `set` | `set-key`（three-step TTY wizard, echo disabled）`show-key` `clear-key` `set-api base <url>` / `model <id>` / `reset` `history on\|off` `reload` |
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
