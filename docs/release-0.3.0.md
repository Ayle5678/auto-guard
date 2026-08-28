# Release 0.3.0 — artifacts and steps

Unified version: **0.3.0** (continues dsh 0.2.0's mainline semantics; direct successor of pi 0.1.3 / zcode 0.1.0).

## Pre-flight

- `pnpm install && pnpm -r typecheck && pnpm -r test` green (all packages).
- `pnpm smoke` green (zcode end-to-end hook run; pi/dsh adapter smokes).
- `git tag v0.3.0` on the release commit.

## Channel artifacts

### ZCode (`packages/host-zcode`)

- Plugin bundle: `plugin.json` (`.zcode-plugin/`), `hooks/hooks.json`, `commands/{guard,guard-set,guard-examine}.md`, prebuilt `dist/` (`pnpm --filter @auto-guard/host-zcode build`).
- Distribution: ZCode plugin install channel; verify `${ZCODE_PLUGIN_ROOT}` placeholders resolve after install.

### Pi (`packages/host-pi`)

- Package root: manifest carries `"pi": {"extensions": ["./src/index.ts"]}`; jiti runs TS directly — no build required.
- Distribution: Pi extension install (link or package); peer runtime `@earendil-works/pi-coding-agent` supplied by Pi itself.

### DSH (`packages/host-dsh`)

- Plugin bundle: `src/` (cordis entry), `client.js` settings page, `typert.ts` remote manifest, `cordis.patch.yml` (auto-guard permission preset).
- Distribution: DSH plugin install; `@deepseek-ai/*` runtimes supplied by the harness.

### npm (`packages/cli`, optional)

- `@auto-guard/cli` with bin `auto-guard` (unified management CLI; SPEC 0002 installer lands here).

## Post-release

- Apply `docs/cutover/legacy-repos.md` banners + archive the three predecessor repos.
- Announce: config roots unchanged, zero-migration upgrade.
