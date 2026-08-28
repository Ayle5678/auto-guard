import { describe, expect, it } from 'vitest'
import { fixedTokensAfterFirst, skeletonHasPlaceholder, skeletonOf, tokenizeCommand } from '../src/skeleton.ts'

describe('skeleton: tokenizer', () => {
  it('keeps quoted strings with spaces as one token', () => {
    expect(tokenizeCommand('grep "hello world" file.txt')).toEqual(['grep', '"hello world"', 'file.txt'])
  })

  it('keeps shell separators as distinct tokens', () => {
    expect(tokenizeCommand('ls | head -5 && echo ok; pwd')).toEqual(['ls', '|', 'head', '-5', '&&', 'echo', 'ok', ';', 'pwd'])
  })

  it('keeps 2>&1 as one token', () => {
    expect(tokenizeCommand('npm test 2>&1 | tail -20')).toContain('2>&1')
  })
})

describe('skeleton: placeholders', () => {
  it('replaces quoted strings, paths, numbers, hashes, urls, variables and flag values', () => {
    expect(skeletonOf('grep "foo" src/a.ts | head -5')).toBe('grep <str> <path> | head <num>')
    expect(skeletonOf('cat /tmp/a.txt')).toBe('cat <path>')
    expect(skeletonOf('echo https://example.com/x')).toBe('echo <url>')
    expect(skeletonOf('echo abc123def456')).toBe('echo <hash>')
    expect(skeletonOf('echo $HOME')).toBe('echo <var>')
    expect(skeletonOf('python run.py --end 2026-08-23 --days 7')).toBe('python <path> --end <date> --days <num>')
    expect(skeletonOf('git -C /tmp/repo status')).toBe('git -C <path> status')
  })

  it('keeps flags and fixed words intact', () => {
    expect(skeletonOf('grep -n foo')).toBe('grep -n <arg>')
    expect(skeletonOf('git status --short')).toBe('git status --short')
    expect(skeletonOf('python -m pytest tests -q')).toBe('python -m pytest tests -q')
  })

  it('groups unquoted positional args for simple read-only commands', () => {
    expect(skeletonOf('grep foo a.txt')).toBe('grep <arg> <path>')
    expect(skeletonOf('grep bar b.txt')).toBe('grep <arg> <path>')
    expect(skeletonOf('cat foo')).toBe('cat <arg>')
    expect(skeletonOf('cat bar')).toBe('cat <arg>')
  })

  it('is pipe-order sensitive', () => {
    const a = skeletonOf('grep foo file | head -5')
    const b = skeletonOf('head -5 | grep foo file')
    expect(a).not.toBe(b)
  })

  it('detects placeholders and counts fixed tokens after first', () => {
    expect(skeletonHasPlaceholder('python <path> --end <date>')).toBe(true)
    expect(skeletonHasPlaceholder('git status')).toBe(false)
    expect(fixedTokensAfterFirst('python -m pytest <path> -q')).toBe(3)
    expect(fixedTokensAfterFirst('python <path>')).toBe(0)
  })
})
