#!/usr/bin/env node
/**
 * `auto-guard` bin entry: parse argv, run the shell, print output.
 *
 * Windows discipline: natural exit via process.exitCode (never process.exit),
 * letting libuv drain open handles after fetch calls.
 */
import { runCli } from './shell.ts'

async function main(): Promise<number> {
  const result = await runCli(process.argv.slice(2))
  for (const line of result.output) process.stdout.write(`${line}\n`)
  return result.code
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
