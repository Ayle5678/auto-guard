import { describe, expect, it } from 'vitest'
import { GUARDED_TOOL_NAMES, normalizeHookInput, toGuardRequest } from '../src/claude-adapter.ts'

const SESSION = 'sess_abc123'

describe('GUARDED_TOOL_NAMES', () => {
  it('covers the matcher tool set (Claude Code: no ApplyPatch, plus NotebookEdit)', () => {
    expect(Object.keys(GUARDED_TOOL_NAMES).sort()).toEqual(['Bash', 'Edit', 'NotebookEdit', 'Read', 'Write'])
  })

  it('maps NotebookEdit to the guard-side edit kind', () => {
    expect(GUARDED_TOOL_NAMES['NotebookEdit']).toBe('edit')
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

  it('passes through untracked tools', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Grep', tool_input: {} }), ws)
    expect(result).toEqual({ kind: 'passthrough', reason: 'untracked tool Grep' })
  })

  it('passes through the zcode-only ApplyPatch alias (not a Claude Code tool)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'ApplyPatch', tool_input: { file_path: 'C:/a' } }), ws)
    expect(result.kind).toBe('passthrough')
  })

  it('treats unreadable Bash params as unreviewable (fail closed)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Bash' }), ws)
    expect(result.kind).toBe('unreviewable')
  })

  it('maps Write/Edit file paths and content', () => {
    for (const tool of ['Write', 'Edit']) {
      const result = toGuardRequest(normalizeHookInput({ tool_name: tool, tool_input: { file_path: 'C:/a.txt', content: 'hi' } }), ws)
      expect(result.kind).toBe('guardable')
      if (result.kind === 'guardable') {
        expect(result.request.filePath).toBe('C:/a.txt')
        if (tool !== 'Read') expect(result.request.content).toBe('hi')
      }
    }
  })

  it('maps NotebookEdit via notebook_path + new_source', () => {
    const result = toGuardRequest(
      normalizeHookInput({ session_id: SESSION, tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:/nb.ipynb', new_source: 'print(1)' } }),
      ws,
    )
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') {
      expect(result.request.tool).toBe('edit')
      expect(result.request.filePath).toBe('C:/nb.ipynb')
      expect(result.request.content).toBe('print(1)')
    }
  })

  it('maps NotebookEdit with no new_source (pure insertion) without content', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:/nb.ipynb' } }), ws)
    expect(result.kind).toBe('guardable')
    if (result.kind === 'guardable') expect(result.request.content).toBeUndefined()
  })

  it('treats NotebookEdit without any path as unreviewable (fail closed)', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'NotebookEdit', tool_input: { new_source: 'x' } }), ws)
    expect(result.kind).toBe('unreviewable')
  })

  it('drops empty-string parameters to unreviewable', () => {
    const result = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: { command: '' } }))
    expect(result.kind).toBe('unreviewable')
  })
})
