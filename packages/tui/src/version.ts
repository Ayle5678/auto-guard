/**
 * TUI package version for the brand chrome (SPEC 0010) — same house pattern
 * as the installer banner's `cliVersion()`: resolve this package's own
 * package.json through createRequire, degrade to `?` when unreadable.
 * Resolved once at module load, so `render` stays free of I/O (ADR-0014).
 */
import { createRequire } from 'node:module'

const VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url)
    return (require('../package.json') as { version?: string }).version ?? '?'
  } catch {
    return '?'
  }
})()

export function tuiVersion(): string {
  return VERSION
}
