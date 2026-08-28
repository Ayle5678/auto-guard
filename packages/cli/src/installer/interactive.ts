/**
 * TTY interaction helpers (ticket 02): selection parsing and confirmation are
 * pure functions over injected lines, so the interactive flow is testable
 * without a real terminal. Non-TTY runs never reach here — the init handler
 * refuses and points at `--host`/`--yes`.
 */
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

/**
 * Render the checkbox list and resolve the final selection. `readLine` is
 * injectable; returns the selected candidate ids (possibly empty) plus notes
 * for hosts the user added manually but then declined to confirm.
 */
export async function promptHostSelection(
  candidates: readonly SelectionCandidate[],
  readLine: (prompt: string) => Promise<string>,
): Promise<{ selected: string[]; notes: string[] }> {
  const notes: string[] = []
  const lines = candidates.map((c, i) => {
    const state = c.detected ? '[x]' : '[ ]'
    const evidence = c.detected ? `（${c.evidence.join('；')}）` : '（未检测到）'
    return `  ${state} ${i + 1}. ${c.label} ${evidence}`
  })
  const header = '检测到以下宿主，选择要接入的（已检测到的默认勾选）：'
  const answer = await readLine([header, ...lines, '回车确认默认勾选，或输入序号切换（如 1,3）：'].join('\n'))
  const parsed = parseSelection(answer, candidates.length)
  if (parsed === null) {
    return { selected: [], notes: ['无法解析输入，已取消'] }
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
      const answer = await readLine(`未检测到 ${candidate.label}，写入目标：${candidate.target}。仍要接入？（误选可在此否决）(y/N)：`)
      if (isConfirmed(answer)) selected.push(candidate.id)
      else notes.push(`已跳过 ${candidate.label}（未确认）`)
    }
  }
  return { selected, notes }
}
