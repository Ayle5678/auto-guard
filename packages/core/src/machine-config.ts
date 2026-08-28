/**
 * Machine default language: `~/.auto-guard/config.json` (ADR-0011).
 *
 * The file lives in auto-guard's own namespace (same home prefix as
 * `~/.auto-guard/bin/`), so it violates no host config root (SPEC 0002). The
 * installer writes it right after the language prompt or `--lang`; hosts read
 * it as the third layer of the four-layer resolution. Unknown fields are
 * ignored on read and preserved on write; only `lang` is ever touched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { envLang, normalizeLang, type Lang } from './lang.ts'

/** Path of the machine default config under a home directory. */
export function machineConfigPath(home: string): string {
  return join(home, '.auto-guard', 'config.json')
}

/** Read the machine default language; missing, unparseable or invalid files resolve to undefined. */
export function readMachineLang(path: string): Lang | undefined {
  try {
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { lang?: unknown }
    if (!parsed || typeof parsed !== 'object') return undefined
    return normalizeLang(typeof parsed.lang === 'string' ? parsed.lang : undefined)
  } catch {
    return undefined
  }
}

/** Persist the machine default language, preserving any unrelated fields. */
export function writeMachineLang(path: string, lang: Lang): void {
  let doc: Record<string, unknown> = {}
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) doc = { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    // Unparseable existing file: start fresh rather than refuse to remember the language.
  }
  doc.lang = lang
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8' })
}

/**
 * Four-layer language resolution (ADR-0011), pure so the whole matrix is
 * unit-testable: `AUTO_GUARD_LANG` env > per-host config.lang > machine
 * default > zh fallback.
 */
export function effectiveLang(input: { env?: Lang | undefined; configLang?: Lang | undefined; machineLang?: Lang | undefined }): Lang {
  return input.env ?? input.configLang ?? input.machineLang ?? 'zh'
}

/**
 * Resolve the effective language for one process (ADR-0011): env >
 * config.lang > machine default > zh, reading the machine file under `home`.
 * Hosts call this once per process/runtime build; callers needing injection
 * (tests, the unified CLI) compose {@link effectiveLang} themselves.
 */
export function resolveProcessLang(configLang: Lang | undefined, home: string = homedir()): Lang {
  return effectiveLang({ env: envLang(), configLang, machineLang: readMachineLang(machineConfigPath(home)) })
}
