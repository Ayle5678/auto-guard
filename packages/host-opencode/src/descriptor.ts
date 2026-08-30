/**
 * OpenCode host descriptor (ADR-0016, ADR-0015): the pure data the shared
 * runtime needs to run the guard for OpenCode. The `{status,reason}` exit
 * contract rides the wire serializer slot; the plugin-side bus wiring
 * (plugin.ts, SeenRequests, payload builders) stays host-side — it is real
 * host coupling, not descriptor data.
 */
import type { HostDescriptor } from '@auto-guard/host-runtime'
import { opencodeWire } from '@auto-guard/host-runtime'
import { OPENCODE_CAPABILITIES } from './opencode-capabilities.ts'

export const OPENCODE_DESCRIPTOR: HostDescriptor = {
  hostId: 'opencode',
  // OpenCode follows the XDG layout.
  configRootSegments: ['.config', 'opencode', 'auto-guard'],
  // The plugin feeds the spawned hook CLI with guard-side names already
  // resolved (bash/edit/read permission types); `edit` covers edit/write/
  // patch host-side.
  guardedTools: {
    bash: { guardTool: 'bash' },
    edit: { guardTool: 'edit' },
    read: { guardTool: 'read' },
  },
  pathFields: ['file_path', 'filePath', 'path'],
  contentFields: ['content'],
  history: {
    bashNames: ['bash'],
    pathFields: ['file_path', 'filePath', 'path'],
  },
  envNames: {
    // Session identity comes from the event payload; this env chain only
    // steers the disk state directory.
    session: ['OPENCODE_SESSION_ID'],
    workspace: ['OPENCODE_WORKTREE'],
  },
  capabilities: OPENCODE_CAPABILITIES,
  // The spawned-decision wire: ALWAYS one JSON verdict, even for allow.
  wire: opencodeWire,
  catalogOverride: {
    // OpenCode routes asks to its native TUI permission dialog, not a
    // confirmation box (pre-runtime opencode wording, kept byte-identical).
    deleteAskReason: {
      zh: '🛡️ auto-guard [删除复核] {flavor}：{reason}。是否仍要执行，请在 OpenCode 权限框中决定。',
      en: '🛡️ auto-guard [deletion review] {flavor}: {reason}. Run it anyway? Decide in the OpenCode permission dialog.',
    },
    // The plugin payload has no tool_input schema to speak of — the wording
    // names metadata/patterns instead (pre-runtime opencode wording).
    unreviewableBash: {
      zh: '无法读取 bash 命令参数（metadata/patterns 均缺失），保守起见需要人工确认',
      en: 'Cannot read the bash command parameters (metadata/patterns both missing); asking a human as a fail-safe',
    },
    unreviewablePath: {
      zh: '无法读取 {tool} 目标路径（metadata/patterns 均缺失），保守起见需要人工确认',
      en: 'Cannot read the {tool} target path (metadata/patterns both missing); asking a human as a fail-safe',
    },
  },
}
