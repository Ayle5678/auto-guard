/**
 * `createHookHost` — the runtime's single entry point (ADR-0016). Given one
 * host descriptor it returns the three process entries (hook, session-start,
 * management CLI) plus the raw emit for tests.
 *
 * `options.home` roots every path (config root, machine-default language
 * file) in a fixture directory for the parameterized contract tests;
 * `options.spawnAnalysis` intercepts the detached analyzer.
 */
import { dirname } from 'node:path'
import type { HostDescriptor } from './descriptor.ts'
import { createConfigSpace } from './config.ts'
import { createBootstrap } from './bootstrap.ts'
import { createExtraction } from './extraction.ts'
import { createHostMessage } from './messages.ts'
import { createHookCliMain } from './hook-cli.ts'
import { createCliMain } from './cli.ts'
import { createSessionMain } from './session-start.ts'
import { createDefaultWire } from './wire.ts'

export interface CreateHookHostOptions {
  /** Root everything in this directory instead of the real home (tests). */
  home?: string
  /** Intercept the detached learned-rule analysis (tests). */
  spawnAnalysis?(command: string, args: readonly string[]): unknown
}

export interface HookHost {
  /** PreToolUse / spawned-decision entry. `io` injects stdin/stdout for tests. */
  hookMain(io?: {
    stdin?: string
    writeOut?(text: string): void
    exit?(code?: number): void
    spawnAnalysis?(command: string, args: readonly string[]): unknown
  }): Promise<void>
  /** SessionStart entry; hosts without one never wire it. */
  sessionMain(options?: { here?(): string }): void
  /** Management CLI entry (argv excludes the binary name). */
  cliMain(argv: readonly string[]): Promise<number>
  /** Raw emit: '' means silence; the wire serializer produces the text. */
  emit(text: string): void
}

export function createHookHost(descriptor: HostDescriptor, options: CreateHookHostOptions = {}): HookHost {
  const space = createConfigSpace(descriptor, options.home)
  const message = createHostMessage(descriptor)
  const kit = createBootstrap(descriptor, space, options.home)
  const extraction = createExtraction(descriptor, message)
  // SPEC 0015: the capability-aware default wire translates ask→deny for
  // hosts whose protocol cannot surface an ask (codex); descriptor.wire still wins.
  const wire = descriptor.wire ?? createDefaultWire(descriptor.capabilities)

  const hookMain = createHookCliMain({ descriptor, space, kit, extraction, message, wire })
  const cliMain = createCliMain({ space, kit, message })
  const sessionMain = createSessionMain(space)

  return {
    hookMain: (io) =>
      hookMain({
        ...(io
          ? {
              readStdin: async () => io.stdin ?? '',
              writeOut: (text) => {
                io.writeOut?.(text)
              },
              exit: (code) => io.exit?.(code),
              spawn: (command, args) => {
                ;(io.spawnAnalysis ?? options.spawnAnalysis ?? (() => undefined))(command, args)
              },
              here: () => dirname(process.argv[1] ?? '.'),
            }
          : {}),
      }),
    sessionMain: (sessionOptions) =>
      sessionMain({ here: sessionOptions?.here, spawnAnalysis: options.spawnAnalysis }),
    cliMain,
    emit: (text) => {
      if (!text) return
      process.stdout.write(text + '\n', () => process.exit(0))
    },
  }
}
