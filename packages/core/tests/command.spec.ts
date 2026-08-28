import { describe, expect, it } from 'vitest'
import { expandHome, isHighRiskStateChangingCommand, isLowRiskStateChangingCommand, isStateChangingCommand, normalizeCommand, splitShellCommand } from '../src/command.ts'

describe('command: normalization', () => {
  it('collapses redundant whitespace', () => {
    expect(normalizeCommand('ls    -la')).toBe('ls -la')
    expect(normalizeCommand('  pwd   ')).toBe('pwd')
  })

  it('is used by case-insensitive matching in classify/matchPattern', () => {
    // normalizeCommand only collapses whitespace; case-insensitivity happens
    // at match time, so GIT STATUS should NOT be lowercased here.
    expect(normalizeCommand('GIT STATUS')).toBe('GIT STATUS')
  })
})

describe('command: splitting', () => {
  it('splits ; && || outside quotes, but not inside quotes', () => {
    expect(splitShellCommand('ls; pwd')).toEqual(['ls', 'pwd'])
    expect(splitShellCommand('ls && pwd')).toEqual(['ls', 'pwd'])
    expect(splitShellCommand('ls || pwd')).toEqual(['ls', 'pwd'])
    expect(splitShellCommand('echo "a;b"')).toEqual(['echo "a;b"'])
  })

  it('does not split pipelines by default', () => {
    expect(splitShellCommand('ls | pwd')).toEqual(['ls | pwd'])
    expect(splitShellCommand('ls | pwd', true)).toEqual(['ls', 'pwd'])
  })
})

describe('command: state-changing detection', () => {
  it('detects environment and shell state changers', () => {
    expect(isStateChangingCommand('export PATH=/tmp/evil:$PATH')).toBe(true)
    expect(isStateChangingCommand('cd /tmp')).toBe(true)
    expect(isStateChangingCommand('source ./setup.sh')).toBe(true)
    expect(isStateChangingCommand('git config --global user.name x')).toBe(true)
    expect(isStateChangingCommand('umask 000')).toBe(true)
    expect(isStateChangingCommand('alias ll="ls -la"')).toBe(true)
  })

  it('does not flag ordinary or echo-only commands', () => {
    expect(isStateChangingCommand('ls')).toBe(false)
    expect(isStateChangingCommand('git status')).toBe(false)
    expect(isStateChangingCommand('echo export')).toBe(false)
    expect(isStateChangingCommand('pwd')).toBe(false)
  })

  it('separates low-risk directory navigation from high-risk state changers', () => {
    expect(isLowRiskStateChangingCommand('cd /tmp')).toBe(true)
    expect(isLowRiskStateChangingCommand('pushd /tmp')).toBe(true)
    expect(isLowRiskStateChangingCommand('popd')).toBe(true)
    expect(isLowRiskStateChangingCommand('export PATH=/tmp/evil:$PATH')).toBe(false)
    expect(isLowRiskStateChangingCommand('alias ll="ls -la"')).toBe(false)

    expect(isHighRiskStateChangingCommand('cd /tmp')).toBe(false)
    expect(isHighRiskStateChangingCommand('export PATH=/tmp/evil:$PATH')).toBe(true)
    expect(isHighRiskStateChangingCommand('source ./setup.sh')).toBe(true)
    expect(isHighRiskStateChangingCommand('alias ll="ls -la"')).toBe(true)
    expect(isHighRiskStateChangingCommand('git config --global user.name x')).toBe(true)
  })
})

describe('command: home expansion', () => {
  it('expands leading ~ to the user home dir', () => {
    const out = expandHome('~/.pi/auto-guard')
    expect(out.startsWith('~')).toBe(false)
    expect(out.endsWith('.pi/auto-guard')).toBe(true)
  })

  it('leaves non-home paths untouched', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path')
  })
})
