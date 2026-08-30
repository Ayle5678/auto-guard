/**
 * Claude Code host descriptor (ADR-0016): the pure data the shared runtime
 * needs to run the guard for Claude Code. Behavior lives in
 * @auto-guard/host-runtime; this file only declares how Claude Code differs.
 */
import type { HostDescriptor } from '@auto-guard/host-runtime'
import { CLAUDE_CAPABILITIES } from './claude-capabilities.ts'

export const CLAUDE_DESCRIPTOR: HostDescriptor = {
  hostId: 'claude',
  configRootSegments: ['.claude', 'auto-guard'],
  guardedTools: {
    Bash: { guardTool: 'bash' },
    Read: { guardTool: 'read' },
    Write: { guardTool: 'write' },
    Edit: { guardTool: 'edit' },
    // NotebookEdit is the .ipynb write path.
    NotebookEdit: { guardTool: 'edit' },
  },
  // NotebookEdit carries the .ipynb path in notebook_path; the other file
  // tools use file_path (snake) / filePath (camel) / path (defensive).
  pathFields: ['notebook_path', 'file_path', 'filePath', 'path'],
  // NotebookEdit's replacement source arrives as new_source.
  contentFields: ['content', 'file_text', 'new_source'],
  history: {
    bashNames: ['bash', 'pwsh'],
    pathFields: ['file_path', 'filePath', 'path', 'notebook_path'],
  },
  envNames: {
    session: ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID'],
    workspace: ['CLAUDE_PROJECT_DIR'],
  },
  capabilities: CLAUDE_CAPABILITIES,
  // wire: omitted — Claude Code speaks the default hookSpecificOutput dialect.
}
