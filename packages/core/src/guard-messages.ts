/**
 * Shared guard-surface message catalog (zh / en) — the user-visible wording
 * of the guard surface itself (receipts, usage, the deletion flow, key and
 * audit management), hosted in core beside `defineCatalog` so every host
 * resolves it through one definition (ADR-0023). Host chrome — dialogs,
 * settings pages, installer, TUI — stays in the host packages; host-flavored
 * wording rides `HostDescriptor.catalogOverride` (ADR-0016). Key parity
 * between languages is enforced by the type system.
 */
import { defineCatalog, type Lang } from './lang.ts'

const zhGuardSurface = {}
const enGuardSurface: Record<keyof typeof zhGuardSurface, string> = {}

const catalog = defineCatalog(zhGuardSurface, enGuardSurface)

/** One guard-surface message key (populated by SPEC 0021 ticket 02). */
export type GuardMessageKey = Parameters<typeof catalog.message>[1]

/** Look up one shared guard-surface message. */
export function guardMessage(lang: Lang, key: GuardMessageKey, params: Record<string, string | number> = {}): string {
  return catalog.message(lang, key, params)
}

/** All guard-surface keys (the anti-drift check set for host catalogs). */
export const guardMessageKeys: readonly GuardMessageKey[] = Object.keys(zhGuardSurface) as GuardMessageKey[]

/** Runtime key test: does this string name a shared guard-surface key? */
export function isGuardMessageKey(key: string): key is GuardMessageKey {
  return key in zhGuardSurface
}
