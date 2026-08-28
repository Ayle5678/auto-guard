import { describe, expect, it } from 'vitest'
import { isSensitivePath, matchesSensitivePath, shellCommandHasSensitivePath } from '../src/sensitive-path.ts'

const PATTERNS = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa', 'id_rsa.pub', 'credentials', 'credentials.json', '*.credentials', '.ssh/', '.aws/', '/etc/', '/var/lib/private/']

describe('sensitive-path: matching', () => {
  it('flags credential and key file patterns', () => {
    expect(isSensitivePath('/workspace/.env', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/.env.local', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/keys/app.pem', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/id_rsa', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/.ssh/config', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/.aws/credentials', PATTERNS)).toBe(true)
    expect(isSensitivePath('/etc/passwd', PATTERNS)).toBe(true)
    expect(isSensitivePath('/workspace/credentials.json', PATTERNS)).toBe(true)
  })

  it('does not flag ordinary source or data files', () => {
    expect(isSensitivePath('/workspace/src/app.ts', PATTERNS)).toBe(false)
    expect(isSensitivePath('/workspace/README.md', PATTERNS)).toBe(false)
    expect(isSensitivePath('/workspace/package.json', PATTERNS)).toBe(false)
    expect(isSensitivePath('/workspace/.gitignore', PATTERNS)).toBe(false)
  })

  it('matches directory-style patterns for any path underneath', () => {
    expect(matchesSensitivePath('/workspace/.ssh/key', '.ssh/')).toBe(true)
    expect(matchesSensitivePath('/workspace/.ssh', '.ssh/')).toBe(true)
    expect(matchesSensitivePath('/workspace/src/app.ts', '.ssh/')).toBe(false)
  })

  it('matches bare-name patterns against the basename', () => {
    expect(matchesSensitivePath('/workspace/secrets/id_rsa', 'id_rsa')).toBe(true)
    expect(matchesSensitivePath('/workspace/src/app.ts', 'id_rsa')).toBe(false)
  })
})

describe('sensitive-path: shell command matching', () => {
  it('detects sensitive paths in shell command tokens', () => {
    expect(shellCommandHasSensitivePath('head .env', PATTERNS)).toBe(true)
    expect(shellCommandHasSensitivePath('sort ~/.ssh/known_hosts', PATTERNS)).toBe(true)
    expect(shellCommandHasSensitivePath('file "/workspace/credentials.json"', PATTERNS)).toBe(true)
    expect(shellCommandHasSensitivePath('xxd /etc/passwd', PATTERNS)).toBe(true)
    expect(shellCommandHasSensitivePath('cat id_rsa.pub', PATTERNS)).toBe(true)
  })

  it('does not flag ordinary shell commands', () => {
    expect(shellCommandHasSensitivePath('ls src', PATTERNS)).toBe(false)
    expect(shellCommandHasSensitivePath('git status', PATTERNS)).toBe(false)
    expect(shellCommandHasSensitivePath('head package.json', PATTERNS)).toBe(false)
    expect(shellCommandHasSensitivePath('find . -name "*.env.example"', PATTERNS)).toBe(false)
  })

  it('detects sensitive paths anywhere in a pipeline or compound', () => {
    expect(shellCommandHasSensitivePath('head .env | sort', PATTERNS)).toBe(true)
    expect(shellCommandHasSensitivePath('ls; file ./id_rsa', PATTERNS)).toBe(true)
  })
})
