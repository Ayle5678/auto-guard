/**
 * TTY interaction helpers (ticket 02): selection parsing and confirmation are
 * pure functions over injected lines, so the interactive flow is testable
 * without a real terminal. Non-TTY runs never reach here — the init handler
 * refuses and points at `--host`/`--yes`.
 *
 * The language prompt is the one message that must be bilingual by
 * construction: it is asked before the user's language is known.
 */
import { message, type Lang } from './i18n.ts'

export interface SelectionCandidate {
  id: string
  label: string
  detected: boolean
  evidence: string[]
  /** Where the installer would write (file or command) — confirmed for manual picks. */
  target: string
}

/** Parse "1 3" / "1,3" / "" into 0-based indices; null when unparseable or out of range. */
export function parseSelection(input: string, count: number): number[] | null {
  const trimmed = input.trim()
  if (trimmed === '') return []
  const parts = trimmed.split(/[\s,，]+/).filter(Boolean)
  const indices: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 1 || n > count) return null
    if (!indices.includes(n - 1)) indices.push(n - 1)
  }
  return indices
}

/** y/yes/是 confirm; everything else declines. */
export function isConfirmed(input: string): boolean {
  return /^(y|yes|是)$/i.test(input.trim())
}

const LANGUAGE_MENU = ['请选择语言 / Select language:', '  1. 中文 (Chinese)', '  2. English', '输入序号 / enter 1 or 2 [1]: '].join('\n')

/**
 * Ask the user to pick the installer language. Bare Enter defaults to 中文
 * (the prompt shows [1]); both the numbers and the language names are
 * accepted. Re-asks with a bilingual hint until the answer parses.
 */
export async function promptLanguage(readLine: (prompt: string) => Promise<string>): Promise<Lang> {
  let hint = ''
  for (;;) {
    const answer = (await readLine(`${hint}${LANGUAGE_MENU}`)).trim().toLowerCase()
    if (answer === '' || /^(1|zh|中文|汉语|chinese)$/.test(answer)) return 'zh'
    if (/^(2|en|english|英语|英文)$/.test(answer)) return 'en'
    hint = '（无效输入，请输入 1 或 2 / invalid input, enter 1 or 2）\n'
  }
}

/**
 * Render the checkbox list and resolve the final selection. `readLine` is
 * injectable; returns the selected candidate ids (possibly empty) plus notes
 * for hosts the user added manually but then declined to confirm.
 */
export async function promptHostSelection(
  candidates: readonly SelectionCandidate[],
  readLine: (prompt: string) => Promise<string>,
  lang: Lang = 'zh',
): Promise<{ selected: string[]; notes: string[] }> {
  const t = (key: Parameters<typeof message>[1], params: Record<string, string | number> = {}): string => message(lang, key, params)
  const notes: string[] = []
  const joiner = lang === 'zh' ? '；' : '; '
  const lines = candidates.map((c, i) => {
    const state = c.detected ? '[x]' : '[ ]'
    const evidence = c.detected ? t('evidenceSuffix', { evidence: c.evidence.join(joiner) }) : t('notDetectedSuffix')
    return `  ${state} ${i + 1}. ${c.label} ${evidence}`
  })
  const header = `${t('selectHeader')}\n${lines.join('\n')}\n${t('selectHint')}`
  const answer = await readLine(header)
  const parsed = parseSelection(answer, candidates.length)
  if (parsed === null) {
    return { selected: [], notes: [t('selectionParseFailed')] }
  }
  const toggled = new Set(parsed)
  const defaults = new Set(candidates.map((c, i) => (c.detected ? i : -1)).filter((i) => i >= 0))
  const chosen = new Set<number>()
  for (let i = 0; i < candidates.length; i++) {
    // Toggling semantics: listed numbers flip the default; unlisted keep it.
    const on = toggled.has(i) ? !defaults.has(i) : defaults.has(i)
    if (on) chosen.add(i)
  }
  const selected: string[] = []
  for (const i of chosen) {
    const candidate = candidates[i]!
    if (candidate.detected) {
      selected.push(candidate.id)
    } else {
      const answer = await readLine(t('manualConfirmPrompt', { label: candidate.label, target: candidate.target }))
      if (isConfirmed(answer)) selected.push(candidate.id)
      else notes.push(t('manualSkippedNote', { label: candidate.label }))
    }
  }
  return { selected, notes }
}
