/**
 * Codex adapter surface: tool-name table, payload normalization and the
 * SPEC 0015 apply_patch patch-text extraction (every `*** … File:` header
 * becomes a reviewed path; headerless patches fail closed).
 */
import { describe, expect, it } from 'vitest'
import { GUARDED_TOOL_NAMES, normalizeHookInput, toGuardRequest } from '../src/codex-adapter.ts'
import { parsePatchPaths } from '@auto-guard/host-runtime'

describe('guarded tool table', () => {
  it('guards Bash plus the apply_patch alias set', () => {
    expect(Object.keys(GUARDED_TOOL_NAMES).sort()).toEqual(['Bash', 'Edit', 'Write', 'apply_patch'])
    expect(GUARDED_TOOL_NAMES['Bash']).toBe('bash')
    expect(GUARDED_TOOL_NAMES['apply_patch']).toBe('edit')
    expect(GUARDED_TOOL_NAMES['Edit']).toBe('edit')
    expect(GUARDED_TOOL_NAMES['Write']).toBe('edit')
  })
})

describe('normalizeHookInput', () => {
  it('keeps session identity from the payload (codex injects no env vars)', () => {
    const input = normalizeHookInput({ session_id: 'thr-1', cwd: '/tmp/proj', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(input.session_id).toBe('thr-1')
    expect(input.cwd).toBe('/tmp/proj')
    expect(input.tool_name).toBe('Bash')
  })
})

describe('toGuardRequest: bash surface', () => {
  it('maps Bash with the full script string', () => {
    const r = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: { command: 'git status && npm test' } }))
    expect(r).toMatchObject({ kind: 'guardable', request: { tool: 'bash', command: 'git status && npm test' } })
  })

  it('fails closed when the command field is missing', () => {
    const r = toGuardRequest(normalizeHookInput({ tool_name: 'Bash', tool_input: {} }))
    expect(r.kind).toBe('unreviewable')
  })
})

describe('toGuardRequest: apply_patch surface', () => {
  const patch = ['*** Begin Patch', '*** Update File: src/app.ts', '@@ -1,2 +1,3 @@', '-old', '+new', '*** Add File: src/other.ts', '+export {}', '*** Delete File: legacy.ts', '*** End Patch'].join('\n')

  it('extracts every patch header as a reviewed path', () => {
    const r = toGuardRequest(normalizeHookInput({ tool_name: 'apply_patch', tool_input: { command: patch } }))
    expect(r.kind).toBe('guardable')
    if (r.kind !== 'guardable') return
    expect(r.request.tool).toBe('edit')
    expect(r.request.filePath).toBe('src/app.ts')
    expect(r.request.paths).toEqual(['src/app.ts', 'src/other.ts', 'legacy.ts'])
  })

  it('treats Edit/Write aliases as the same patch surface', () => {
    for (const tool of ['Edit', 'Write']) {
      const r = toGuardRequest(normalizeHookInput({ tool_name: tool, tool_input: { command: patch } }))
      expect(r.kind).toBe('guardable')
    }
  })

  it('never treats patch content lines as paths', () => {
    expect(parsePatchPaths('*** Begin Patch\n*** Update File: a.ts\n+*** Delete File: fake-in-content.ts\n*** End Patch')).toEqual(['a.ts'])
  })

  it('parses Move-to rename targets and dedupes', () => {
    const moved = ['*** Begin Patch', '*** Update File: old.ts', '@@', '*** Move to: new.ts', '*** Move to: new.ts', '*** End Patch'].join('\n')
    expect(parsePatchPaths(moved)).toEqual(['old.ts', 'new.ts'])
  })

  it('fails closed on a missing or headerless patch text', () => {
    expect(toGuardRequest(normalizeHookInput({ tool_name: 'apply_patch', tool_input: {} })).kind).toBe('unreviewable')
    expect(toGuardRequest(normalizeHookInput({ tool_name: 'apply_patch', tool_input: { command: 'rm -rf /tmp/x' } })).kind).toBe('unreviewable')
  })
})

describe('passthrough surface', () => {
  it('passes untracked codex tools silently (update_plan, view_image, mcp__*)', () => {
    for (const tool of ['update_plan', 'view_image', 'mcp__deepseek__search']) {
      expect(toGuardRequest(normalizeHookInput({ tool_name: tool, tool_input: {} })).kind).toBe('passthrough')
    }
  })
})
