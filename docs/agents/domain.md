# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.
- **`docs/grill-log.md`** — the self-directed design interview that produced the initial ADR set; read it when you need the reasoning *behind* an ADR or want to see rejected branches.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   ├── agents/
│   ├── adr/
│   └── grill-log.md
└── packages/
```

This repo is **single-context**: the workspace packages (`core`, host adapters, installer) are a technical split, not a domain split. One `CONTEXT.md` and one `docs/adr/` at the root cover everything.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

## Predecessor ADRs

The three predecessor repos carry their own ADR sets (`dsh-auto-guard` ADR-0001..0021, `pi-auto-guard` ADR-0001..0020, `zcode-auto-guard` ADR-0001..0006). Where this repo's ADRs supersede them, the superseding ADR says so explicitly (e.g. ADR-0001 supersedes zcode's ADR-0001 "copied core not shared package"). When porting behavior, still consult the predecessor ADR for the original rationale.
