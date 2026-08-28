import { describe, expect, it } from 'vitest'
import { GUARDABLE_TOOLS, toGuardRequest, type PiToolCallLike } from '../src/adapter.ts'

describe('adapter: GUARDABLE_TOOLS', () => {
  it('guards bash, write, edit and read (pwsh reserved)', () => {
    for (const t of ['bash', 'write', 'edit', 'read', 'pwsh']) {
      expect(GUARDABLE_TOOLS.has(t)).toBe(true)
    }
    expect(GUARDABLE_TOOLS.size).toBe(5)
  })
})

describe('adapter: toGuardRequest', () => {
  it('maps a bash tool call to a shell guard request', () => {
    const exec: PiToolCallLike = { tool: 'bash', command: 'ls -la', session: 's1', workspace: '/w' }
    expect(toGuardRequest(exec)).toMatchObject({ tool: 'bash', command: 'ls -la', session: 's1', workspace: '/w' })
  })

  it('maps write file_path and content to a file guard request', () => {
    const exec: PiToolCallLike = { tool: 'write', filePath: '/w/src/a.ts', content: 'export {}', session: 's1', workspace: '/w' }
    expect(toGuardRequest(exec)).toMatchObject({ tool: 'write', filePath: '/w/src/a.ts', content: 'export {}' })
  })

  it('maps edit file_path to a file guard request (no content)', () => {
    const exec: PiToolCallLike = { tool: 'edit', filePath: '/w/src/a.ts', session: 's1', workspace: '/w' }
    expect(toGuardRequest(exec)).toMatchObject({ tool: 'edit', filePath: '/w/src/a.ts' })
  })

  it('maps read file_path to a read guard request', () => {
    const exec: PiToolCallLike = { tool: 'read', filePath: '/w/src/a.ts', session: 's1', workspace: '/w' }
    expect(toGuardRequest(exec)).toMatchObject({ tool: 'read', filePath: '/w/src/a.ts' })
  })

  it('returns undefined for missing command/path', () => {
    expect(toGuardRequest({ tool: 'bash', session: 's1', workspace: '/w' })).toBeUndefined()
    expect(toGuardRequest({ tool: 'read', session: 's1', workspace: '/w' })).toBeUndefined()
  })

  it('returns undefined for out-of-scope tools', () => {
    expect(toGuardRequest({ tool: 'grep', session: 's1', workspace: '/w' })).toBeUndefined()
  })
})
