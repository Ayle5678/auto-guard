/**
 * Ambient type declarations for the DeepSeek Harness (DSH) SDK packages.
 *
 * The real `@deepseek-ai/*` packages are provided by the DSH plugin runtime;
 * they are not installable from a registry, so host-dsh compiles against this
 * minimal structural surface.
 */
declare module '@deepseek-ai/cordis' {
  export interface Context {
    get<T = unknown>(service: string): T | undefined
    provide(service: string, value: unknown): void
    on(event: string, listener: (payload: unknown) => void): void
    inject(deps: string[], callback: (scoped: Context) => void): void
    tools?: {
      guard(guard: (exec: unknown) => string | undefined): void
    }
    approval?: unknown
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolExecution {
    name: string
    arguments: unknown
    signal: AbortSignal
    agent?: {
      session?: {
        id?: string
        header?: { cwd?: string; workspace?: string }
        events?: readonly unknown[]
        append?(type: string, data: unknown): unknown
        inject?(message: unknown): unknown
      }
    }
  }

  export interface PreToolDecision {
    kind: 'deny' | 'ask'
    reason?: string
  }

  export type ToolGuard = (exec: ToolExecution) => string | undefined
}

declare module '@deepseek-ai/dsh-settings' {
  export interface SettingsScope {
    get(): Record<string, unknown>
    update(patch: Record<string, unknown>): Promise<void>
    watch(listener: () => void): () => void
  }

  export interface SettingsNamespace {
    ns: string
  }

  export function settingsNamespace(ns: string): SettingsNamespace
}

declare module '@deepseek-ai/dsh-llm' {
  export interface GenerateOptions {
    provider?: string
    model: string
    messages: unknown[]
    system?: string
    reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | (string & {})
    signal?: AbortSignal
    [key: string]: unknown
  }

  export interface StreamChunk {
    type: string
    text?: string
    reason?: { kind: string; failure?: { message?: string } }
  }

  export interface UserMessage {
    id: string
    role: 'user'
    content: Array<{ type: string; text?: string }>
    source?: unknown
  }
}
