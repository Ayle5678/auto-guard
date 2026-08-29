/**
 * Terminal driver (SPEC 0009 ticket 01 / ADR-0014) — the only module that
 * touches the real TTY. Kept intentionally thin: raw mode + alternate screen
 * + line-diff repaint + resize watch + guaranteed restore. Everything
 * repaintable is decided by pure render functions elsewhere.
 *
 * Non-TTY or dumb terminals are refused by `assertInteractive` (fail-closed,
 * exit 2) — the TUI is for humans; agents and pipes use the CLI.
 */
import { emitKeypressEvents } from 'node:readline'
import { normalizeKeypress, type KeyEvent } from './keys.ts'
import { rowToString, type Row } from './ui/theme.ts'

export interface KeyStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): void
  pause?(): void
  on(event: 'keypress', listener: (str: string, key: Record<string, unknown>) => void): unknown
  on(event: 'resize', listener: () => void): unknown
  off?(event: 'keypress' | 'resize', listener: (...args: unknown[]) => void): unknown
}

export interface OutStream {
  columns?: number
  rows?: number
  write(text: string): void
  on?(event: 'resize', listener: () => void): unknown
}

const ALT_SCREEN_ON = '\x1b[?1049h'
const ALT_SCREEN_OFF = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_SCREEN = '\x1b[2J'
const HOME = '\x1b[1;1H'

/** Refuse to start outside a real, capable terminal (exit 2 path). */
export function assertInteractive(stdin: { isTTY?: boolean }, env: Record<string, string | undefined>): string | null {
  if (!stdin.isTTY) return 'notATty'
  if (env.TERM === 'dumb') return 'dumbTerm'
  return null
}

/**
 * One terminal session. `paint` diffs against the previous frame and rewrites
 * only changed rows; same-content frames cost a single cursor-home. `restore`
 * is idempotent and also registered on process 'exit' so even a crash leaves
 * the shell usable.
 */
export class Terminal {
  private readonly out: (text: string) => void
  private readonly input: KeyStream
  private readonly output: OutStream
  private readonly colorEnabled: boolean
  private lastFrame: string[] = []
  private frameHeight = 0
  private keyListener: ((str: string, key: Record<string, unknown>) => void) | null = null
  private resizeListener: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private restored = false

  constructor(
    input: KeyStream,
    output: OutStream,
    options: { colorEnabled?: boolean; onKey?: (ev: KeyEvent) => void; onResize?: () => void; pollMs?: number } = {},
  ) {
    this.input = input
    this.output = output
    this.out = output.write.bind(output)
    this.colorEnabled = options.colorEnabled ?? true
    if (options.onKey) {
      this.keyListener = (str: string, key) => options.onKey!(normalizeKeypress(str, key))
      emitKeypressEvents(input as unknown as NodeJS.ReadableStream)
      input.on('keypress', this.keyListener)
    }
    if (options.onResize) {
      this.resizeListener = options.onResize
      // stdout carries the size; Windows terminals do not always raise the
      // event, so a cheap poll backs it up.
      output.on?.('resize', this.resizeListener)
      this.pollTimer = setInterval(() => {
        if (!this.restored) options.onResize!()
      }, options.pollMs ?? 500)
      this.pollTimer.unref?.()
    }
  }

  get width(): number {
    return Math.max(40, Math.min(240, this.output.columns || 80))
  }

  get height(): number {
    return Math.max(12, Math.min(200, this.output.rows || 24))
  }

  /** Enter full-screen mode: alt buffer, hidden cursor, raw input. */
  enter(): void {
    this.input.setRawMode?.(true)
    this.out(HIDE_CURSOR + ALT_SCREEN_ON + CLEAR_SCREEN + HOME)
    this.frameHeight = 0
    this.lastFrame = []
  }

  /** Repaint with line diffing; returns the bytes written (tests). */
  paint(frame: readonly Row[]): string {
    const next = frame.map((row) => rowToString(row, this.colorEnabled))
    let buffer = ''
    const fullRepaint = next.length !== this.frameHeight
    if (fullRepaint) {
      buffer += CLEAR_SCREEN + HOME
      this.frameHeight = next.length
      this.lastFrame = []
    }
    for (let y = 0; y < next.length; y++) {
      if (this.lastFrame[y] === next[y]) continue
      buffer += `\x1b[${y + 1};1H\x1b[2K${next[y]}`
    }
    this.lastFrame = next
    if (buffer) this.out(buffer)
    return buffer
  }

  /** Leave full-screen mode and give the shell back a clean terminal. */
  restore(): void {
    if (this.restored) return
    this.restored = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.keyListener) this.input.off?.('keypress', this.keyListener as (...args: unknown[]) => void)
    if (this.resizeListener) this.input.off?.('resize', this.resizeListener)
    this.input.setRawMode?.(false)
    this.out(ALT_SCREEN_OFF + SHOW_CURSOR)
  }
}
