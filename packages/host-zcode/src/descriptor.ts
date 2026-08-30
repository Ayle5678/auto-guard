/**
 * ZCode host descriptor (ADR-0016): the pure data the shared runtime needs
 * to run the guard for ZCode. Behavior lives in @auto-guard/host-runtime;
 * this file only declares how ZCode differs.
 */
import type { HostDescriptor } from '@auto-guard/host-runtime'
import { ZCODE_CAPABILITIES } from './zcode-capabilities.ts'

export const ZCODE_DESCRIPTOR: HostDescriptor = {
  hostId: 'zcode',
  configRootSegments: ['.zcode', 'auto-guard'],
  guardedTools: {
    Bash: { guardTool: 'bash' },
    Read: { guardTool: 'read' },
    Write: { guardTool: 'write' },
    Edit: { guardTool: 'edit' },
    // ApplyPatch is the alias ZCode reports for Write/Edit style edits.
    ApplyPatch: { guardTool: 'edit' },
  },
  pathFields: ['file_path', 'filePath', 'path'],
  contentFields: ['content', 'file_text'],
  history: {
    bashNames: ['bash', 'pwsh'],
    pathFields: ['file_path', 'filePath', 'path', 'notebook_path'],
  },
  envNames: {
    session: ['ZCODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID'],
    workspace: ['ZCODE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR'],
  },
  capabilities: ZCODE_CAPABILITIES,
  // wire: omitted — zcode speaks the default hookSpecificOutput dialect.
}
