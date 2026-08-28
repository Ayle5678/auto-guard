# Unified CLI (`auto-guard`)

The management CLI is a thin terminal shell over the shared core operations layer. All subcommands work identically against any host's config root.

```
auto-guard [--config-root <path>] <group> <action> [args]
```

`--config-root` resolution order: flag → `AUTO_GUARD_CONFIG_ROOT` env → auto-detect (`~/.zcode` / `~/.pi` / `~/.dsh`, first existing).

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
