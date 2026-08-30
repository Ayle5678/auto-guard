/**
 * `buildGuardDeps` — the shared GuardDeps assembly (ADR-0016): the learned
 * rule load, template-cache wiring and the `GuardDeps` literal that every
 * host used to copy. Hook hosts call it from the runtime bootstrap;
 * process-form hosts (pi / dsh) call it directly and keep choosing their own
 * session-state / audit implementations — only the wiring is shared.
 */
import {
  GuardService,
  loadLearnedRules,
  TemplateCache,
  type GuardDeps,
  type GuardConfig,
  type HistoryStore,
  type Lang,
  type LlmReviewer,
  type FileTracker,
  type PersistentCache,
  type RulesFile,
} from '@auto-guard/core'

/** Everything except the template cache: chosen by the calling host. */
export interface GuardDepsParts {
  config: GuardConfig
  rules: RulesFile
  lang: Lang
  sessionCache: GuardDeps['sessionCache']
  persistentCache: PersistentCache
  llmReviewer: LlmReviewer
  fileTracker: FileTracker
  historyStore?: HistoryStore
  pendingPersistence?: GuardDeps['pendingPersistence']
}

export interface GuardWiring {
  deps: GuardDeps
  /** Learned rules parsed from disk; hosts expose them in their own state objects. */
  learned: ReturnType<typeof loadLearnedRules>
  templateCache: TemplateCache
}

export function buildGuardDeps(parts: GuardDepsParts): GuardWiring {
  const learned = loadLearnedRules(parts.config.learnedRulesPath, [...parts.rules.hardDeny, ...parts.rules.alwaysReview, ...parts.rules.directoryDelete])
  const templateCache = new TemplateCache(parts.config.templateCachePath)
  templateCache.setCacheablePatterns(learned.cacheable)
  const deps: GuardDeps = {
    config: parts.config,
    rules: parts.rules,
    sessionCache: parts.sessionCache,
    persistentCache: parts.persistentCache,
    llmReviewer: parts.llmReviewer,
    fileTracker: parts.fileTracker,
    historyStore: parts.historyStore,
    templateCache,
    pendingPersistence: parts.pendingPersistence,
    lang: parts.lang,
  }
  return { deps, learned, templateCache }
}

/** The one `new GuardService` in the repo: shared wiring + service construction (ADR-0016). */
export function createGuardService(parts: GuardDepsParts): GuardWiring & { service: GuardService } {
  const wiring = buildGuardDeps(parts)
  return { ...wiring, service: new GuardService(wiring.deps) }
}
