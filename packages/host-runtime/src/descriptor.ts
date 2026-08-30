/**
 * The host descriptor (ADR-0016): pure data pinning down everything the
 * shared hook runtime needs to know about one hook-form host. A new hook
 * host is a descriptor file; the moment a descriptor wants to grow a
 * behavior function (beyond the wire serializer slot) the seam is wrong —
 * bring it back to ADR-0016.
 */
import type { Decision, HostCapabilities, Lang } from '@auto-guard/core'

/** Guard-side tool names the payload can map to (the GuardRequest vocabulary). */
export type GuardTool = 'bash' | 'read' | 'write' | 'edit'

export interface ToolMapping {
  guardTool: GuardTool
  /**
   * SPEC 0012: set when the tool's payload carries a target path instead of
   * a command. The runtime synthesizes `<synthesizeCommand> "<path>"` as the
   * GuardRequest command so the request rides the exact shell pipeline
   * (qoder `delete_file` → `'rm'`). A missing path is unreviewable —
   * fail-closed, never a pass.
   */
  synthesizeCommand?: string
  /**
   * SPEC 0015: set when the named tool_input field carries an apply_patch
   * V4A patch text (codex `apply_patch`/`Edit`/`Write` aliases put the whole
   * patch in `tool_input.command`). The runtime parses the patch headers into
   * the full target-path set; a missing field or a headerless patch is
   * unreviewable — fail-closed, never a pass.
   */
  patchCommand?: string
}

/** Decision metadata carried alongside a wire outcome for status bookkeeping. */
export type OutcomeMeta = Pick<Decision, 'kind' | 'source' | 'risk'> & { reviewerFailed?: boolean; detail?: string }

/**
 * Runtime-neutral decision outcome. The wire serializer slot turns this into
 * the host's exact stdout contract; `meta` never reaches the wire.
 */
export interface WireOutcome {
  action: 'allow' | 'deny' | 'ask'
  reason?: string
  meta?: OutcomeMeta
}

/**
 * Exit serializer slot (ADR-0016): the one place host wire dialects differ.
 * Default (omitted) = the Claude-compatible `hookSpecificOutput` dialect
 * shared by zcode/claude/qoder/codex, capability-translated (SPEC 0015);
 * opencode injects its `{status,reason}` verdict contract here.
 */
export interface WireSerializer {
  /** stdout text for the final outcome; '' means silence (allow for hook hosts). `lang` is the resolved process/runtime language for host-flavored notes. */
  serialize(outcome: WireOutcome, lang?: Lang): string
}

/** The eight data fields of a host (ADR-0016) plus the two extension slots. */
export interface HostDescriptor {
  /** Host identity, e.g. `'zcode'`. Diagnostics only — never wired into decisions. */
  hostId: string
  /** Config root segments under the user's home: `['.zcode', 'auto-guard']` → `~/.zcode/auto-guard`. */
  configRootSegments: readonly string[]
  /**
   * Guarded tool/permission names → guard-side mapping. Keys are the raw
   * `tool_name` spellings the host feeds the guard (both naming sets where a
   * host has two, permission types for opencode).
   */
  guardedTools: Record<string, ToolMapping>
  /** Path-field defensive chain for file tools (first present wins). */
  pathFields: readonly string[]
  /** Content-field defensive chain for write/edit tools (first present wins). */
  contentFields: readonly string[]
  /** Subject recorded for `guard recent` (the decision-history entry). */
  history: {
    /** Lowercased raw tool names whose subject is a shell command. */
    bashNames: readonly string[]
    /** Path-field chain for every other tool's subject. */
    pathFields: readonly string[]
  }
  /** Session/workspace identity env chains (workspace falls back to `process.cwd()`). */
  envNames: {
    session: readonly string[]
    workspace: readonly string[]
  }
  /** Host capability values (ADR-0007). */
  capabilities: HostCapabilities
  /** Exit wire slot; omitted = the default `hookSpecificOutput` dialect. */
  wire?: WireSerializer
  /**
   * Host-flavored catalog overrides: message key → per-language replacement.
   * Only for wording that genuinely differs per host (e.g. opencode names its
   * permission dialog); everything else rides the shared runtime catalog.
   */
  catalogOverride?: Readonly<Record<string, Partial<Record<Lang, string>>>>
}
