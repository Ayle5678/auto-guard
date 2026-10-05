/**
 * User-rules hotfix patterns (SPEC 0027 A2): the staticAllow entries added
 * directly to this machine's user rules.json — taskkill by PID, localhost
 * probes, workspace scripts/. Array items never propagate through defaults
 * (ADR-0013), so the patterns are pinned here to keep the hotfix auditable
 * and copyable to other machines by hand.
 */
import { describe, expect, it } from 'vitest'
import { classifyCommand, matchPattern, readDefaults } from '../src/rules.ts'
import type { PatternRule, RulesFile } from '../src/types.ts'

const hotfix: PatternRule[] = [
  { pattern: 'taskkill //PID *', reason: 'Killing a process the agent started, by exact PID' },
  { pattern: 'taskkill /PID *', reason: 'Killing a process the agent started, by exact PID' },
  { pattern: 'curl * http://127.0.0.1:*', reason: 'Localhost health probe' },
  { pattern: 'curl * http://localhost:*', reason: 'Localhost health probe' },
  { pattern: 'node scripts/*', reason: 'Running the workspace scripts/ tooling' },
]

const rules: RulesFile = { ...readDefaults(), staticAllow: [...readDefaults().staticAllow, ...hotfix] }

describe('user-rules hotfix patterns (SPEC 0027 A2)', () => {
  it('match the decision-history command shapes', () => {
    expect(matchPattern('taskkill //PID 40136 //F', 'taskkill //PID *')).toBe(true)
    expect(matchPattern('taskkill /PID 40136 /F', 'taskkill /PID *')).toBe(true)
    expect(matchPattern('curl -s -m 3 http://127.0.0.1:8600/health', 'curl * http://127.0.0.1:*')).toBe(true)
    expect(matchPattern('curl -s -m 3 http://localhost:8600/health', 'curl * http://localhost:*')).toBe(true)
    expect(matchPattern('node scripts/registry-offline.mjs 2>&1', 'node scripts/*')).toBe(true)
  })

  it('do not over-allow neighboring shapes', () => {
    expect(matchPattern('taskkill //IM explorer.exe //F', 'taskkill //PID *')).toBe(false)
    expect(matchPattern('taskkill /IM explorer.exe /F', 'taskkill /PID *')).toBe(false)
    expect(matchPattern('curl -s https://api.example.com/data', 'curl * http://127.0.0.1:*')).toBe(false)
    expect(matchPattern('curl -s https://api.example.com/data', 'curl * http://localhost:*')).toBe(false)
    expect(matchPattern('node /etc/foreign.mjs', 'node scripts/*')).toBe(false)
    expect(matchPattern('node ../outside/evil.mjs', 'node scripts/*')).toBe(false)
  })

  it('classify the hotfixed shapes as static-allow end to end', () => {
    for (const command of [
      'taskkill //PID 40136 //F',
      'taskkill /PID 40136 /F',
      'curl -s -m 3 http://127.0.0.1:8600/health',
      'curl -s -m 3 http://localhost:8600/health',
      'node scripts/registry-offline.mjs 2>&1',
    ]) {
      expect(classifyCommand(command, rules).category).toBe('static-allow')
    }
  })
})
