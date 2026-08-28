/**
 * Ambient type declarations for the Pi extension SDK.
 *
 * The real `@earendil-works/pi-coding-agent` package is provided by the Pi
 * runtime (jiti loads this extension inside Pi); it is not installable from a
 * registry, so host-pi compiles against this minimal structural surface.
 */
declare module '@earendil-works/pi-coding-agent' {
  export interface BashOperations {
    exec(command: string, cwd: string, options?: unknown): Promise<unknown> | unknown
  }

  export interface ToolCallInput {
    command?: string
    path?: string
    content?: string
    [key: string]: unknown
  }

  export interface ToolCallEvent {
    type: string
    toolName: string
    input: ToolCallInput
  }

  export interface UserBashEvent {
    command: string
    cwd: string
  }

  export interface PiUi {
    theme: { fg(color: 'success' | 'error' | 'warning' | 'dim', text: string): string }
    setStatus(key: string, text: string | undefined): void
    notify(message: string, level?: 'info' | 'warning' | 'error'): void
    input(title: string, placeholder?: string): Promise<string | undefined>
    select(title: string, options: string[]): Promise<string | undefined>
    confirm(title: string, message: string): Promise<boolean>
  }

  export interface PiContext {
    hasUI: boolean
    ui: PiUi
    cwd: string
    signal?: AbortSignal
    sessionManager: { getSessionId(): string | undefined }
  }

  export interface ExtensionAPI {
    on(event: 'tool_call', handler: (event: ToolCallEvent, ctx: PiContext) => Promise<{ block?: boolean; reason?: string } | void>): void
    on(
      event: 'user_bash',
      handler: (
        event: UserBashEvent,
        ctx: PiContext,
      ) => Promise<{ result?: { output: string; exitCode: number; cancelled: boolean; truncated: boolean }; operations?: { exec: BashOperations['exec'] } } | void>,
    ): void
    on(event: 'session_start' | 'session_shutdown', handler: (_event: unknown, ctx: PiContext) => Promise<void>): void
    registerCommand(name: string, options: { description: string; handler: (args: string | undefined, ctx: PiContext) => Promise<void> | void }): void
    sendMessage(message: { customType: string; content: string; display: boolean }): void
  }

  export function createLocalBashOperations(): { exec(command: string, cwd: string, options?: unknown): Promise<unknown> }
  export function isToolCallEventType<T extends 'bash' | 'read' | 'write' | 'edit'>(kind: T, event: ToolCallEvent): boolean
}
