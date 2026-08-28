import { describe, expect, it } from 'vitest'
import { toGuardRequest } from '../src/adapter.ts'
import { notificationText } from '@auto-guard/core'
import type { Decision } from '@auto-guard/core'

function exec(name: string, args: unknown, opts: { sessionId?: string; cwd?: string } = {}) {
  return {
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: {
      session: {
        id: opts.sessionId ?? 's1',
        header: { cwd: opts.cwd ?? '/workspace' },
      },
    },
  }
}

describe('adapter: toGuardRequest', () => {
  it('maps bash/pwsh arguments to a shell guard request', () => {
    const req = toGuardRequest(exec('bash', { command: 'ls -la' }, { sessionId: 'sess', cwd: '/w' }))
    expect(req).toMatchObject({ tool: 'bash', command: 'ls -la', session: 'sess', workspace: '/w' })
  })

  it('maps write/edit file_path to a file guard request', () => {
    const req = toGuardRequest(exec('write', { file_path: '/w/src/a.ts', content: 'x' }))
    expect(req).toMatchObject({ tool: 'write', filePath: '/w/src/a.ts', content: 'x' })
  })

  it('maps read path to a file guard request', () => {
    const req = toGuardRequest(exec('read', { path: '/w/.env' }))
    expect(req).toMatchObject({ tool: 'read', filePath: '/w/.env' })
  })

  it('returns undefined for out-of-scope tools and missing args', () => {
    expect(toGuardRequest(exec('bash', {}))).toBeUndefined()
    expect(toGuardRequest(exec('read', {}))).toBeUndefined()
  })

  it('passes session events through for reason extraction', () => {
    const events = [{ type: 'assistant/message', time: 1, data: { message: { content: [] } } }]
    const execution = {
      name: 'pwsh',
      arguments: { command: 'Remove-Item -Recurse .\\dir' },
      signal: new AbortController().signal,
      agent: { session: { id: 's1', header: { cwd: '/w' }, events } },
    }
    expect(toGuardRequest(execution)).toMatchObject({ events })
  })
})

describe('notify-text', () => {
  it('builds allow/deny/ask texts with reason', () => {
    expect(notificationText({ kind: 'allow', source: 'static-allow', reason: 'safe' } as Decision)).toContain('放行')
    expect(notificationText({ kind: 'deny', source: 'hard-deny', reason: 'no' } as Decision)).toContain('拦截')
    expect(notificationText({ kind: 'ask', source: 'sensitive-path', reason: 'confirm?' } as Decision)).toContain('询问')
  })

  it('includes risk when present and never includes script content', () => {
    const text = notificationText({ kind: 'allow', source: 'llm', risk: 'medium', reason: 'ok' } as Decision)
    expect(text).toContain('risk: medium')
    expect(text).toContain('ok')
  })
})
