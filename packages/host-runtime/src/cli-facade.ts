import type { HostDescriptor } from './descriptor.ts'
import { createHookHost, type CreateHookHostOptions } from './create-hook-host.ts'

/**
 * CLI entry runner for host facades: detects direct invocation (the dist
 * cli.js was the entry) or the AUTO_GUARD_CLI_ENTRY test switch, then runs
 * the host's management CLI with natural-exit discipline.
 */
export function runCliFacade(descriptor: HostDescriptor, entryUrl: string, options: CreateHookHostOptions = {}): void {
  const invokedDirectly = process.argv[1] && entryUrl === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
  if (!invokedDirectly && process.env.AUTO_GUARD_CLI_ENTRY !== '1') return
  createHookHost(descriptor, options)
    .cliMain(process.argv.slice(2))
    .then((code) => {
      // Natural exit (not process.exit) lets libuv drain open handles — avoids
      // the UV_HANDLE_CLOSING assertion crash on Windows after fetch calls.
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stdout.write(`${String(error instanceof Error ? error.message : error)}\n`)
      process.exitCode = 1
    })
}
