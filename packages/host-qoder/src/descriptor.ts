/**
 * Qoder host descriptor (ADR-0016): the pure data the shared runtime needs
 * to run the guard for Qoder. Behavior lives in @auto-guard/host-runtime;
 * this file only declares how Qoder differs (two tool-naming sets, the
 * SPEC 0012 delete_file rm synthesis, the long-name path spellings).
 */
import type { HostDescriptor } from '@auto-guard/host-runtime'
import { QODER_CAPABILITIES } from './qoder-capabilities.ts'

export const QODER_DESCRIPTOR: HostDescriptor = {
  hostId: 'qoder',
  configRootSegments: ['.qoder', 'auto-guard'],
  guardedTools: {
    // Short names first (the set the official docs and Qoder's own hook
    // examples use), then the long internal names, then the apply_patch
    // edit alias and the delete_file removal (SPEC 0012: guarded as a
    // synthesized single-file `rm "<path>"`).
    Bash: { guardTool: 'bash' },
    Read: { guardTool: 'read' },
    Write: { guardTool: 'write' },
    Edit: { guardTool: 'edit' },
    run_in_terminal: { guardTool: 'bash' },
    read_file: { guardTool: 'read' },
    create_file: { guardTool: 'write' },
    search_replace: { guardTool: 'edit' },
    apply_patch: { guardTool: 'edit' },
    delete_file: { guardTool: 'bash', synthesizeCommand: 'rm' },
  },
  // The long internal names carry their path in path/filepath spellings; the
  // short ones follow Claude Code's file_path (snake) / filePath (camel).
  pathFields: ['file_path', 'filePath', 'filepath', 'path'],
  // search_replace spells the replacement source new_string/newString;
  // create_file mirrors Claude Code's content/file_text.
  contentFields: ['content', 'file_text', 'new_string', 'newString', 'new_source'],
  history: {
    bashNames: ['bash', 'pwsh', 'run_in_terminal'],
    pathFields: ['file_path', 'filePath', 'path', 'filepath'],
  },
  envNames: {
    // QODER_SESSION_ID is documented in docs.qoder.com/extensions/hooks;
    // QODER_PROJECT_DIR comes from the CN CLI dialect and costs nothing to honor.
    session: ['QODER_SESSION_ID'],
    workspace: ['QODER_PROJECT_DIR', 'QODER_CWD'],
  },
  capabilities: QODER_CAPABILITIES,
  // wire: omitted — Qoder speaks the default hookSpecificOutput dialect.
  catalogOverride: {
    // Qoder's unreviewable-bash wording names the raw tool and carries no
    // bracket suffix (pre-runtime qoder wording, kept byte-identical).
    unreviewableBash: {
      zh: '无法读取 {tool} 命令参数（tool_input 解析失败），保守起见需要人工确认',
      en: 'Cannot read the {tool} command parameters (tool_input failed to parse); asking a human as a fail-safe',
    },
  },
}
