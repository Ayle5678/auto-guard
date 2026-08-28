/**
 * Host detection (ticket 01): scan a fake-able HOME for per-profile evidence
 * and report confidence plus the evidence itself, so the interactive flow can
 * show *why* a host was flagged and the user can veto a false positive.
 * Detection is heuristic only — never a substitute for the user's choice.
 */
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { PROFILES, type HostProfile } from './profiles.ts'

export type Confidence = 'high' | 'medium' | 'none'

export interface DetectionResult {
  profile: HostProfile
  detected: boolean
  confidence: Confidence
  /** Human-readable evidence lines (Chinese, user-facing). */
  evidence: string[]
}

export interface DetectOptions {
  /** Override HOME (tests, `--home`). */
  home?: string
  /** Override executable probe (tests). */
  hasExecutable?: (exe: string) => boolean
  profiles?: readonly HostProfile[]
}

export function detectHosts(options: DetectOptions = {}): DetectionResult[] {
  const home = options.home ?? homedir()
  const hasExecutable = options.hasExecutable ?? defaultHasExecutable
  const profiles = options.profiles ?? PROFILES
  return profiles.map((profile) => {
    const evidence: string[] = []
    const fileHit = profile.detection.files.find((f) => existsSync(join(home, f)))
    if (fileHit) evidence.push(`存在 ~/${fileHit}`)
    const dirHits = profile.detection.dirs.filter((d) => existsSync(join(home, d)))
    for (const dir of dirHits) evidence.push(`存在 ~/${dir}`)
    const exeHits = profile.detection.executables.filter((exe) => hasExecutable(exe))
    for (const exe of exeHits) evidence.push(`找到可执行文件 ${exe}`)

    // Detection follows the spec's AND semantics: a strong file marker alone,
    // or directory AND executable together. An executable on PATH by itself is
    // not the host — avoid installing into an absent host's config.
    const dirAndExe = dirHits.length > 0 && exeHits.length > 0
    const detected = fileHit !== undefined || dirAndExe
    const confidence: Confidence = fileHit ? 'high' : dirAndExe ? 'high' : dirHits.length ? 'medium' : 'none'
    return { profile, detected, confidence, evidence }
  })
}

/** PATH scan with Windows extensions; zero dependencies, existsSync only. */
export function defaultHasExecutable(exe: string): boolean {
  const pathEnv = process.env.PATH ?? ''
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      if (existsSync(join(dir, exe + ext))) return true
    }
  }
  return false
}
