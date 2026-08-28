/**
 * Language helpers shared by every package (ADR-0011).
 *
 * Core owns only the lookup mechanics — `Lang`, `normalizeLang`, `envLang` and
 * the `defineCatalog` factory that gives each package a flat zh/en dictionary
 * with compile-time key parity. The catalog text itself belongs to the
 * consuming package; core hosts no translations beyond its own messages.
 */
export type Lang = 'zh' | 'en'

/** Accept `zh` / `zh-CN` / `en` / `en-US` (case-insensitive); anything else is invalid. */
export function normalizeLang(value: string | undefined): Lang | undefined {
  const v = value?.trim().toLowerCase()
  if (!v) return undefined
  if (v.startsWith('zh')) return 'zh'
  if (v.startsWith('en')) return 'en'
  return undefined
}

/** `AUTO_GUARD_LANG` env override — the top layer of the four-layer resolution. */
export function envLang(env: Record<string, string | undefined> = process.env): Lang | undefined {
  return normalizeLang(env.AUTO_GUARD_LANG)
}

/** Interpolate `{name}` placeholders; unknown placeholders pass through untouched. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (raw, name: string) => (name in params ? String(params[name]) : raw))
}

/**
 * Build a per-package bilingual catalog from a zh dictionary and an en
 * dictionary keyed identically (the `Record<keyof ZH, string>` annotation is
 * what makes a missing en key a compile error).
 */
export function defineCatalog<const ZH extends Record<string, string>>(zh: ZH, en: Record<keyof ZH, string>) {
  return {
    message(lang: Lang, key: keyof ZH, params: Record<string, string | number> = {}): string {
      return interpolate(lang === 'en' ? en[key] : zh[key], params)
    },
  }
}

/** Per-host config language, or the zh fallback. Machine-default/env layers are resolved by the caller. */
export function langOf(config: { lang?: Lang }): Lang {
  return config.lang ?? 'zh'
}
