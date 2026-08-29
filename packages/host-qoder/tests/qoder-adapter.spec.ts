import { describe, expect, it } from 'vitest'
import { GUARDED_TOOL_NAMES, normalizeHookInput, toGuardRequest } from '../src/qoder-adapter.ts'

const SESSION = 'sess_qoder1'

describe('GUARDED_TOOL_NAMES', () => {
  it('covers both Qoder naming sets plus the apply_patch alias', () => {
    expect(Object.keys(GUARDED_TOOL_NAMES).sort()).toEqual([
      'Bash',
      'Edit',
      'Read',
      'Write',
      'apply_patch',
      'create_file',
      'read_file',
      'run_in_terminal',
      'search_replace',
    ])
  })

  it('maps the long internal names to the same guard-side kinds as the short ones', () => {
    expect(GUARDED_TOOL_NAMES['run_in_terminal']).toBe('bash')
    expect(GUARDED_TOOL_NAMES['read_file']).toBe('read')
    expect(GUARDED_TOOL_NAMES['create_file']).toBe('write')
    expect(GUARDED_TOOL_NAMES['search_replace']).toBe('edit')
    expect(GUARDED_TOOL_NAMES['apply_patch']).toBe('edit')
  })
})

describe('normalizeHookInput', () => {
  it('accepts snake_case payloads', () => {
    const input = normalizeHookInput({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'ls' }, hook_event_name: 'PreToolUse' })
    expect(input.tool_name).toBe('Bash')
    expect(input.session_id).toBe(SESSION)
    expect(input.tool_input).toEqual({ command: 'ls' })
  })

  it('falls back to camelCase aliases', () => {
    const input = normalizeHookInput({ session_id: SESSION, toolName: 'Read', toolInput: { file_path: '/tmp/x' } })
    expect(input.tool_name).toBe('Read')
    expect(input.tool_input).toEqual({ file_path: '/tmp/x' })
  })

  it('is safe against non-object input', () => {
    expect(normalizeHookInput(null)).toEqual({})
    expect(normalizeHookInput('nope')).toEqual({})
  })
})

describe('toGuardRequest', () => {
  const ws = 'D:/work/demo'

  it('maps Bash commands', () => {
    const result = toGuardRequest(normalizeHookInput({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git status' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request).toMatchObject({ tool: 'bash', command: 'git status', session: SESSION, workspace: ws })
    }
  })

  it('maps the run_in_terminal spelling to the same bash request', () => {
    const result = toGuardRequest(normalizeHookInput({ session_id: SESSION, tool_name: 'run_in_terminal', tool_input: { command: 'git status' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request).toMatchObject({ tool: 'bash', command: 'git status', session: SESSION, workspace: ws })
    }
  })

  it('passes through untracked tools', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Grep', tool_input: {} }), ws)
    expect(result).toEqual({ kind: 'passthrough', reason: 'untracked tool Grep' })
  })

  it('passes through delete_file (spec 0005: not guarded in v1 — the bash rm path is)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'delete_file', tool_input: { path: 'C:/a' } }), ws)
    expect(result.kind).toBe('passthrough')
  })

  it('passes through mcp tools', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'mcp__codegraph__codegraph_explore', tool_input: {} }), ws)
    expect(result.kind).toBe('passthrough')
  })

  it('treats unreadable Bash params as unreviewable (fail closed)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Bash' }), ws)
    expect(result.kind).toBe('unreviewable')
  })

  it('treats run_in_terminal without a command as unreviewable too', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'run_in_terminal', tool_input: { cwd: 'D:/x' } }), ws)
    expect(result.kind).toBe('unreviewable')
  })

  it('maps short-name Write/Edit file paths and content', () => {
    for (const tool of ['Write', 'Edit']) {
      const result = toGuardRequest(normalizeHookInput({ tool_name: tool, tool_input: { file_path: 'C:/a.txt', content: 'hi' } }), ws)
      expect(result.kind).toBe('guardable')
      if (result.kind === 'guardable') {
        expect(result.request.filePath).toBe('C:/a.txt')
        if (tool !== 'Read') expect(result.request.content).toBe('hi')
      }
    }
  })

  it('maps long-name create_file via path + content chains', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'create_file', tool_input: { path: 'C:/a.txt', content: 'hi' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request.tool).toBe('write')
      expect(result.request.filePath).toBe('C:/a.txt')
      expect(result.request.content).toBe('hi')
    }
  })

  it('maps search_replace replacement source from new_string/newString', () => {
    for (const key of ['new_string', 'newString']) {
      const result = toGuardRequest(normalizeHookInput({ tool_name: 'search_replace', tool_input: { file_path: 'C:/a.txt', [key]: 'next()' } }), ws)
      expect(result.kind).toBe('guardable')
      if (result.kind === 'guardable') {
        expect(result.request.tool).toBe('edit')
        expect(result.request.content).toBe('next()')
      }
    }
  })

  it('maps the apply_patch alias to edit with the shared path chain', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'apply_patch', tool_input: { filepath: 'C:/a.txt', content: 'x' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request.tool).toBe('edit')
      expect(result.request.filePath).toBe('C:/a.txt')
    }
  })

  it('maps Read without content (pure read path)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'read_file', tool_input: { file_path: 'C:/a.txt' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request).toMatchObject({ tool: 'read', filePath: 'C:/a.txt' })
      expect(result.request.content).toBeUndefined()
    }
  })

  it('treats a guarded file tool without any path as unreviewable (fail closed)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'create_file', tool_input: { content: 'x' } }), ws)
    expect(result.kind).toBe('unreviewable')
  })

  it('drops empty-string parameters to unreviewable', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: { command: '' } }))
    expect(result.kind).toBe('unreviewable')
  })
})
