import { describe, expect, it } from 'vitest'
import { GUARDED_PERMISSION_TYPES, normalizeHookInput, payloadFromAsked, payloadFromSdkPermission, toGuardRequest } from '../src/opencode-adapter.ts'
import type { PermissionAskedProperties } from '../src/opencode-plugin-types.ts'

const WT = '/work/demo'

function asked(overrides: Partial<PermissionAskedProperties> = {}): PermissionAskedProperties {
  return { id: 'perm_1', sessionID: 'ses_1', permission: 'bash', patterns: [], metadata: {}, ...overrides }
}

describe('GUARDED_PERMISSION_TYPES', () => {
  it('covers bash/edit/read only', () => {
    expect(Object.keys(GUARDED_PERMISSION_TYPES).sort()).toEqual(['bash', 'edit', 'read'])
    expect(GUARDED_PERMISSION_TYPES.edit).toBe('edit')
  })
})

describe('payloadFromAsked', () => {
  it('maps bash with metadata.command', () => {
    const payload = payloadFromAsked(asked({ permission: 'bash', metadata: { command: 'git status' } }), WT)
    expect(payload).toEqual({ tool_name: 'bash', tool_input: { command: 'git status' }, session_id: 'ses_1', cwd: WT })
  })

  it('falls back to patterns[0] when bash metadata is empty', () => {
    const payload = payloadFromAsked(asked({ permission: 'bash', patterns: ['rm -rf /'] }), WT)
    expect(payload?.tool_input).toEqual({ command: 'rm -rf /' })
  })

  it('maps edit with metadata.filepath and diff as content', () => {
    const payload = payloadFromAsked(asked({ permission: 'edit', metadata: { filepath: '/w/a.ts', diff: '-old+new' } }), WT)
    expect(payload?.tool_name).toBe('edit')
    expect(payload?.tool_input).toEqual({ file_path: '/w/a.ts', content: '-old+new' })
  })

  it('resolves a worktree-relative pattern against the worktree for read (metadata is empty upstream)', () => {
    const payload = payloadFromAsked(asked({ permission: 'read', patterns: ['src/.env'] }), WT)
    expect(String(payload?.tool_input.file_path).replaceAll('\\', '/')).toBe('/work/demo/src/.env')
  })

  it('returns undefined for unguarded permission types', () => {
    expect(payloadFromAsked(asked({ permission: 'webfetch' }), WT)).toBeUndefined()
    expect(payloadFromAsked(asked({ permission: 'glob' }), WT)).toBeUndefined()
  })
})

describe('payloadFromSdkPermission', () => {
  it('maps the SDK Permission shape (permission.ask forward-compat path)', () => {
    const payload = payloadFromSdkPermission(
      { id: 'p1', type: 'edit', pattern: ['a.ts'], sessionID: 's1', messageID: 'm1', title: 't', metadata: { filepath: '/w/a.ts' } },
      WT,
    )
    expect(payload?.tool_name).toBe('edit')
    expect(payload?.tool_input.file_path).toBe('/w/a.ts')
  })

  // Windows runner only: drive-letter paths are absolute under win32 path
  // semantics (the host's real inputs there) and must pass through unjoined.
  // (Leading semicolon: the previous `})` would otherwise be parsed as a call.)
  ;(process.platform === 'win32' ? it : it.skip)('keeps a drive-letter absolute filepath verbatim (win32)', () => {
    const payload = payloadFromAsked(asked({ permission: 'edit', metadata: { filepath: 'D:/w/a.ts', diff: '-old+new' } }), 'D:/work/demo')
    expect(payload?.tool_input).toEqual({ file_path: 'D:/w/a.ts', content: '-old+new' })
  })

  it('accepts a string pattern', () => {
    const payload = payloadFromSdkPermission(
      { id: 'p1', type: 'read', pattern: 'a.ts', sessionID: 's1', messageID: 'm1', title: 't', metadata: {} },
      WT,
    )
    expect(String(payload?.tool_input.file_path).replaceAll('\\', '/')).toBe('/work/demo/a.ts')
  })
})

describe('toGuardRequest (hook CLI stdin side)', () => {
  it('maps bash commands', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'bash', tool_input: { command: 'git status' }, session_id: 's1' }), WT)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') expect(result.request).toMatchObject({ tool: 'bash', command: 'git status', session: 's1', workspace: WT })
  })

  it('maps edit file paths with content', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'edit', tool_input: { file_path: '/a.ts', content: 'x' } }))
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') expect(result.request).toMatchObject({ tool: 'edit', filePath: '/a.ts', content: 'x' })
  })

  it('flags missing bash command as unreviewable (fail closed → TUI)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'bash', tool_input: {} }))
    expect(result.kind).toBe('unreviewable')
  })

  it('flags missing file path as unreviewable', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'read', tool_input: {} }))
    expect(result.kind).toBe('unreviewable')
  })

  it('passes through untracked tool names', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'webfetch', tool_input: { url: 'https://x' } }))
    expect(result.kind).toBe('passthrough')
  })

  it('is safe against garbage input', () => {
    expect(normalizeHookInput(null)).toEqual({})
    expect(normalizeHookInput('junk')).toEqual({})
  })
})
