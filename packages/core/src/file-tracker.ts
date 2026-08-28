/**
 * File Tracker: detects “write a shell script then execute it” patterns across
 * commands (cross-command) and inside one command (same-command), and checks
 * script paths/content for sensitive material before letting the guard decide.
 */
import { promises as fs } from 'node:fs'
import { normalizeCommand } from './command.ts'
import { isSensitivePath } from './sensitive-path.ts'
import type { FileTrackerResult } from './types.ts'

const WRITE_RE = /(?:|^|\s)(?:>|>>)\s*([^\s;|&"'<>]+)/g
const HEREDOC_RE = /(?:^|;|&&|\|\||\s)(?:cat|tee)\s+([^\s;<>&|]+)/g
const EXEC_RE = /(?:^|;|&&|\|\||\s)(?:bash|sh|zsh)\s+([^\s;|&"']+)/g
const SOURCE_RE = /(?:^|;|&&|\|\||\s)(?:source|\.)\s+([^\s;|&"']+)/g
const DIRECT_RE = /(?:\s|^)(\.\/(?:[^\s;&|]|&&|\|\|)*?)(?:\s|;|$)/g

/** All files targeted for writing in one command, without dupes. */
export function extractWrites(command: string): string[] {
  const found = new Set<string>()
  for (const match of command.matchAll(WRITE_RE)) found.add(match[1])
  for (const match of command.matchAll(HEREDOC_RE)) found.add(match[1])
  return [...found]
}

/** All shell scripts executed in one command, without dupes. */
export function extractExecutions(command: string): string[] {
  const found = new Set<string>()
  for (const match of command.matchAll(EXEC_RE)) found.add(match[1])
  for (const match of command.matchAll(SOURCE_RE)) found.add(match[1])
  for (const match of command.matchAll(DIRECT_RE)) found.add(match[1])
  return [...found]
}

interface WriteEvent {
  path: string
  at: number
}

/** Persistence surface for recorded script writes (hook model spans processes). */
export interface WriteStore {
  get(path: string): number | undefined
  set(path: string, at: number): void
}

/**
 * Tracks written script paths across commands and detects write-then-execute.
 * When a {@link WriteStore} is supplied, write timestamps survive process
 * restarts; otherwise an in-memory map keeps the original behavior (tests).
 */
export class FileTracker {
  private readonly memory = new Map<string, number>()
  private readonly store?: WriteStore
  private readonly windowMs: number

  constructor(windowMs = 5000, store?: WriteStore) {
    this.windowMs = windowMs
    this.store = store
  }

  private readAt(path: string): number | undefined {
    return this.store ? this.store.get(path) : this.memory.get(path)
  }

  private writeAt(path: string, at: number): void {
    if (this.store) this.store.set(path, at)
    else this.memory.set(path, at)
  }

  clear(): void {
    this.memory.clear()
  }

  /**
   * Record writes observed in this command and return any write+execute hits.
   */
  evaluate(command: string): Pick<FileTrackerResult, 'scriptPath' | 'sameCommand'> | null {
    const normalized = normalizeCommand(command)
    const writes = extractWrites(normalized)
    const executions = extractExecutions(normalized)

    const now = Date.now()
    for (const path of writes) this.writeAt(path, now)

    for (const exec of executions) {
      const same = writes.includes(exec)
      const recent = this.readAt(exec)
      if (recent !== undefined && (same || now - recent <= this.windowMs)) {
        return { scriptPath: exec, sameCommand: same }
      }
    }
    return null
  }

  /**
   * Async resolution of a tracker result: read the script content only when it
   * is a safe, non-sensitive shell script; otherwise mark sensitive and omit it.
   */
  async materialize(result: Pick<FileTrackerResult, 'scriptPath' | 'sameCommand'>, sensitivePaths: readonly string[]): Promise<FileTrackerResult> {
    if (isSensitivePath(result.scriptPath, sensitivePaths)) {
      return { ...result, sensitiveContent: true }
    }
    try {
      const content = await fs.readFile(result.scriptPath, 'utf8')
      if (looksLikeSensitiveContent(content)) {
        return { ...result, sensitiveContent: true }
      }
      return { ...result, content, sensitiveContent: false }
    } catch {
      return { ...result, sensitiveContent: true }
    }
  }
}

/**
 * Best-effort heuristic: don't hand raw secrets to the model. A file that looks
 * like it could contain credentials gets flagged and its content is withheld.
 */
export function looksLikeSensitiveContent(content: string): boolean {
  const sample = content.slice(0, 20_000)
  return /(api[_ -]?key|secret|password|token|BEGIN (RSA|OPENSSH|PRIVATE) KEY|aws_[a-z0-9]+)/i.test(sample)
}
