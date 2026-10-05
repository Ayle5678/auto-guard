/**
 * Wrapper unwrapping in deletion-target extraction (SPEC 0028 ticket 03):
 * powershell/pwsh `-Command` and `cmd /c|/k` payloads split into statements
 * and judged by first word, so wrapped-deletion retries neighbor-match by
 * target. Classification itself is untouched (ADR-0012).
 */
import { describe, expect, it } from 'vitest'
import { deletionTierTargets, extractDeletionTargets } from '../src/directory-delete.ts'
import { readDefaults } from '../src/rules.ts'

const rules = readDefaults()

/** Expectation helper applying the same case folding the extractor uses. */
const expectTargets = (command: string, targets: string[]) =>
  expect(extractDeletionTargets(command, rules)).toEqual(
    targets.map((target) => (process.platform === 'win32' ? target.toLowerCase() : target)).sort(),
  )

describe('extractDeletionTargets: wrapper unwrapping', () => {
  it('extracts the target from a powershell -Command wrapper with args and single-quoted path', () => {
    expectTargets(`powershell -NoProfile -NonInteractive -Command "Remove-Item 'C:\\miniforge3_old' -Recurse -Force"`, ['C:/miniforge3_old'])
  })

  it('extracts from pwsh with the -c short flag and an unquoted payload', () => {
    expectTargets('pwsh -c rm -rf /tmp/x', ['/tmp/x'])
  })

  it('extracts from a cmd /c wrapper with a quoted payload', () => {
    expectTargets('cmd /c "rd /s /q .\\dir"', ['./dir'])
  })

  it('extracts only delete statements from a multi-statement payload', () => {
    expectTargets(`powershell -Command "Stop-Process -Name agent; Remove-Item 'C:\\p' -Recurse -Force"`, ['C:/p'])
  })

  it('extracts every delete statement joined by && in the payload', () => {
    expectTargets(`powershell -Command "Remove-Item 'C:\\a' -Recurse && Remove-Item 'C:\\b' -Recurse"`, ['C:/a', 'C:/b'])
  })

  it('extracts from a wrapper segment inside a compound command', () => {
    expectTargets(`cd /ws && powershell -Command "Remove-Item 'C:\\p' -Recurse -Force" && ls`, ['C:/p'])
  })

  it('strips a [删除理由] marker inside the unwrapped payload', () => {
    expectTargets(`powershell -Command "Remove-Item 'C:\\p' -Recurse -Force [删除理由] stale build"`, ['C:/p'])
  })

  it('keeps the classified direct path byte-compatible (cmd /c rd unquoted)', () => {
    expectTargets('cmd /c rd /s /q .\\dir', ['./dir'])
    // Not /tmp/x: absolute POSIX paths match the `rm -rf /*` hard-deny enum
    // and never reach target extraction (pre-existing, unchanged).
    expectTargets('rm -rf ./build/x', ['./build/x'])
  })

  it('does not unwrap -EncodedCommand payloads', () => {
    expect(extractDeletionTargets('powershell -EncodedCommand AbCd123==', rules)).toEqual([])
  })

  it('extracts nothing from non-delete wrappers and never inspects quoted data of other commands', () => {
    expect(extractDeletionTargets('powershell -Command "Get-Process | Sort-Object CPU"', rules)).toEqual([])
    expect(extractDeletionTargets('ls "notes; rm -rf /tmp/x"', rules)).toEqual([])
    expect(extractDeletionTargets('echo rm -rf /tmp/x', rules)).toEqual([])
  })
})

describe('deletionTierTargets: Remove-Item runtime fallback', () => {
  it('falls back to the Remove-Item path when pattern extraction finds nothing', () => {
    expect(deletionTierTargets('Remove-Item C:\\p -Force', rules)).toEqual(['C:\\p'])
    expect(deletionTierTargets(`Remove-Item -LiteralPath 'C:\\p q'`, rules)).toEqual(['C:\\p q'])
  })

  it('prefers pattern extraction when it finds targets', () => {
    const expected = process.platform === 'win32' ? ['c:/p'] : ['C:/p']
    expect(deletionTierTargets(`powershell -Command "Remove-Item 'C:\\p' -Recurse -Force"`, rules)).toEqual(expected)
  })

  it('returns nothing for commands without deletions', () => {
    expect(deletionTierTargets('Get-ChildItem C:\\p', rules)).toEqual([])
  })
})
