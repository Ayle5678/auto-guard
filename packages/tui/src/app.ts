/**
 * App state machine + frame composition (SPEC 0009/0010 / ADR-0014). `reduce`
 * is pure state evolution returning side-effect requests; `render` composes
 * the full frame from pure screen modules. I/O happens only in actions.ts and
 * the tui.ts driver loop.
 */
import { homedir } from 'node:os'
import { maskKey, type Lang } from '@auto-guard/core'
import { renderBannerGrid, GRADIENT } from '@auto-guard/cli/installer/banner'
import { t, resolveUiLang } from './i18n.ts'
import { tuiVersion } from './version.ts'
import type { AppEvent, AppState, DialogState, Effect, InputRequest, PendingRun, Receipt, ScreenId, WizardInput } from './types.ts'
import { SCREEN_ORDER } from './types.ts'
import { detectRoot, detect, loadRootSummaries, needsInstallerLang, validateWizard, type ActionDeps } from './actions.ts'
import { withIntegration } from './screens/installer.ts'
import { dashboardKey, renderDashboard, visibleRoots } from './screens/dashboard.ts'
import { installerKey, renderInstaller } from './screens/installer.ts'
import { renderLog, scrollBy } from './screens/log.ts'
import { helpRowCount, renderHelp } from './screens/help.ts'
import { listActions, renderListScreen, rootSummary, settledCursor, stepCursor } from './screens/lists.ts'
import { confirmDialog, emptyInput, footerBar, headerBar, hintRow, inputKey, inputRow, keyHint, moveCursor, navTabs, padFrame, splitWidth, type NavTab } from './ui/kit.ts'
import { seg, theme, type Row } from './ui/theme.ts'
import { tildeRoot } from './paths.ts'
import { isChar, type KeyEvent } from './keys.ts'
import { wrappedCount } from './ui/text.ts'

export type ListScreen = 'guard' | 'examine' | 'optimize' | 'set'

/** Bootstrap state with real (or test-injected) reads. */
export function initialState(options: { width: number; height: number; deps?: ActionDeps; env?: Record<string, string | undefined> }): AppState {
  const deps = options.deps ?? {}
  const roots = loadRootSummaries(deps)
  const currentRoot = detectRoot(deps)
  const summary = roots.find((r) => r.root === currentRoot && r.seeded)
  const lang = resolveUiLang({ env: options.env, configLang: summary?.config?.lang })
  const detections = withIntegration(detect(deps, lang), deps.home ?? homedir())
  return {
    screen: 'dashboard',
    width: options.width,
    height: options.height,
    lang,
    roots,
    currentRoot,
    focusRoot: Math.max(0, roots.findIndex((r) => r.root === currentRoot)),
    cursor: {},
    views: {},
    installer: {
      tab: 'init',
      cursor: 0,
      checked: {},
      rulesChoice: 'skip',
      langAsked: needsInstallerLang(),
      detections,
      preview: [],
      removeChecked: {},
    },
    wizard: null,
    input: null,
    dialog: null,
    busy: null,
    receipts: [],
    autoloaded: {},
    tick: 0,
    exitAfterBusies: false,
  }
}

/** Pure reduction; effects are requests the driver executes. */
export function reduce(state: AppState, event: AppEvent): { state: AppState; effects: Effect[] } {
  switch (event.type) {
    case 'resized':
      return { state: { ...state, width: event.width, height: event.height }, effects: [] }
    case 'tick':
      return { state: { ...state, tick: state.tick + 1 }, effects: [] }
    case 'busy-start':
      return { state: { ...state, busy: event.run }, effects: [] }
    case 'run-done': {
      const receipts = [...state.receipts, event.receipt]
      return {
        state: { ...state, receipts, busy: null, views: { ...state.views, [state.screen]: stickyView(event.receipt) } },
        effects: [{ type: 'refresh' }],
      }
    }
    case 'autoload-done': {
      // Read-only autoload (SPEC 0010): fills the output pane without touching
      // receipts — the log screen stays a record of user-initiated actions.
      return { state: { ...state, busy: null, views: { ...state.views, [event.screen]: stickyView(event.receipt) } }, effects: [] }
    }
    case 'roots': {
      const roots = event.roots
      const stillThere = roots.some((r) => r.root === state.currentRoot && r.seeded)
      const summary = roots.find((r) => r.root === state.currentRoot && r.seeded)
      const lang = resolveUiLang({ configLang: summary?.config?.lang })
      const detections = withIntegration(detect({}, lang), homedir())
      return {
        state: {
          ...state,
          roots,
          lang: state.installer.tab === 'init' && state.installer.langAsked ? state.lang : lang,
          currentRoot: stillThere ? state.currentRoot : roots.find((r) => r.seeded)?.root ?? '',
          installer: { ...state.installer, detections },
        },
        effects: [],
      }
    }
    case 'key':
      return reduceKey(state, event.key)
  }
}

function reduceKey(state: AppState, key: KeyEvent): { state: AppState; effects: Effect[] } {
  // A notice lives until the next key event (SPEC 0010) — clear it first, so
  // branches below can raise a fresh one.
  const clear: AppState = { ...state, notice: undefined }
  // Busy: only quit escapes.
  if (clear.busy) {
    if (isChar(key, 'q') || (key.name === 'char' && key.ch === 'c' && key.ctrl)) return { state: clear, effects: [{ type: 'quit' }] }
    return { state: clear, effects: [] }
  }
  // Inline input owns every key.
  if (clear.input) return inputKeyRouting(clear, key)
  // Dialog owns every key.
  if (clear.dialog) return dialogKeyRouting(clear, key)
  // Wizard review step owns every key.
  if (clear.wizard) return wizardReviewRouting(clear, key)
  // Global keys.
  if (isChar(key, 'q') || (key.name === 'char' && key.ch === 'c' && key.ctrl)) return { state: clear, effects: [{ type: 'quit' }] }
  if (key.name === 'char' && key.ch === ':') {
    const input: InputRequest = { owner: 'command', prompt: ':', model: emptyInput() }
    return { state: { ...clear, input }, effects: [] }
  }
  if (isChar(key, 'r')) return refreshCurrent(clear)
  // Arrows are the primary screen switch; digits stay as jump shortcuts.
  if (key.name === 'left' || isChar(key, 'h')) return stepScreen(clear, -1)
  if (key.name === 'right' || isChar(key, 'l')) return stepScreen(clear, 1)
  if (key.name === 'char' && key.ch && key.ch >= '1' && key.ch <= '8') {
    return gotoScreen(clear, SCREEN_ORDER[Number(key.ch) - 1]!)
  }
  return screenRouting(clear, key)
}

// ---------- screen switching + autoload (SPEC 0010) ----------

function tabLabelOf(state: AppState, screen: ScreenId): string {
  const tab = NAV_TABS.find((entry) => entry.screen === screen)
  return tab ? t(state.lang, tab.key) : screen
}

function gotoScreen(state: AppState, screen: ScreenId): { state: AppState; effects: Effect[] } {
  const autoload = autoloadEffects(state, screen)
  return {
    state: {
      ...state,
      screen,
      notice: t(state.lang, 'noticeTo', { screen: tabLabelOf(state, screen) }),
      ...(autoload.length ? { autoloaded: { ...state.autoloaded, [screen]: true } } : {}),
    },
    effects: [{ type: 'refresh' }, ...autoload],
  }
}

function stepScreen(state: AppState, delta: 1 | -1): { state: AppState; effects: Effect[] } {
  const index = SCREEN_ORDER.indexOf(state.screen)
  const next = SCREEN_ORDER[(index + delta + SCREEN_ORDER.length) % SCREEN_ORDER.length]!
  return gotoScreen(state, next)
}

/** `r`: refresh data and re-run the current screen's autoload. */
function refreshCurrent(state: AppState): { state: AppState; effects: Effect[] } {
  const autoloaded = { ...state.autoloaded }
  delete autoloaded[state.screen]
  const cleared: AppState = { ...state, notice: t(state.lang, 'noticeRefresh'), autoloaded }
  return { state: cleared, effects: [{ type: 'refresh' }, ...autoloadEffects(cleared, state.screen)] }
}

/** Receipt rendered as a view: command line, output, exit footer. */
function stickyView(receipt: Receipt): { lines: string[]; offset: number } {
  // Huge offset = "stick to bottom"; panel() clamps to total - viewport.
  return { lines: [`❯ ${receipt.argv}`, ...receipt.output, `↳ exit ${receipt.code}`], offset: STICKY_BOTTOM }
}

/** Read-only autoload per screen (SPEC 0010): fill the output pane on first visit. */
export function autoloadRun(state: AppState, screen: ScreenId): PendingRun | null {
  if (screen === 'installer') {
    return state.installer.tab === 'status' ? { kind: 'inst', argv: ['list'], label: 'list', busyKey: 'busyRefresh' } : null
  }
  if (screen === 'dashboard' || screen === 'log' || screen === 'help') return null
  if (!rootSummary(state)) return null
  switch (screen) {
    case 'guard':
      return { kind: 'mgmt', argv: ['guard', 'recent', '10'], label: 'guard recent 10', busyKey: 'busyRefresh' }
    case 'examine':
      return { kind: 'mgmt', argv: ['examine', 'status'], label: 'examine status', busyKey: 'busyRefresh' }
    case 'optimize':
      return { kind: 'mgmt', argv: ['optimize', 'status'], label: 'optimize status', busyKey: 'busyRefresh' }
    case 'set':
      return { kind: 'mgmt', argv: ['set', 'show-key'], label: 'set show-key', busyKey: 'busyRefresh' }
    default:
      return null
  }
}

function autoloadEffects(state: AppState, screen: ScreenId): Effect[] {
  if (state.autoloaded[screen]) return []
  const run = autoloadRun(state, screen)
  return run ? [{ type: 'autoload', run, screen }] : []
}

// ---------- input routing ----------

function inputKeyRouting(state: AppState, key: KeyEvent): { state: AppState; effects: Effect[] } {
  if (key.name === 'escape') {
    // Esc in a wizard step cancels the whole wizard.
    return { state: { ...state, input: null, wizard: null }, effects: [] }
  }
  if (key.name === 'enter') return resolveInput(state)
  return { state: { ...state, input: { ...state.input!, model: inputKey(state.input!.model, key) } }, effects: [] }
}

function resolveInput(state: AppState): { state: AppState; effects: Effect[] } {
  const input = state.input!
  const value = input.model.value
  const close: Partial<AppState> = { input: null }
  switch (input.owner) {
    case 'command': {
      const argv = value.trim().split(/\s+/).filter(Boolean)
      if (!argv.length) return { state: { ...state, ...close }, effects: [] }
      const kind = argv[0] === 'init' || argv[0] === 'list' || argv[0] === 'remove' ? 'inst' : 'mgmt'
      const run: PendingRun = { kind, argv, label: argv.slice(0, 2).join(' ') }
      return { state: { ...state, ...close }, effects: [{ type: 'run', run }] }
    }
    case 'report-days':
      return { state: { ...state, ...close }, effects: [{ type: 'run', run: mgmt(['guard', 'report', value.trim()]) }] }
    case 'recent-count':
      return { state: { ...state, ...close }, effects: [{ type: 'run', run: mgmt(['guard', 'recent', value.trim()]) }] }
    case 'set-api-base':
      return { state: { ...state, ...close }, effects: [{ type: 'run', run: mgmt(['set', 'set-api', 'base', value.trim()]) }] }
    case 'set-api-model':
      return { state: { ...state, ...close }, effects: [{ type: 'run', run: mgmt(['set', 'set-api', 'model', value.trim()]) }] }
    case 'wizard-base': {
      const wizard = { ...state.wizard!, base: value.trim() }
      return { state: { ...state, wizard, input: wizardInput('wizard-model', t(state.lang, 'wizModel', { value: wizard.model }), wizard.model) }, effects: [] }
    }
    case 'wizard-model': {
      const wizard = { ...state.wizard!, model: value.trim() }
      return { state: { ...state, wizard, input: wizardInput('wizard-key', t(state.lang, 'wizKey'), '', true) }, effects: [] }
    }
    case 'wizard-key': {
      const wizard = { ...state.wizard!, key: value }
      return { state: { ...state, wizard, input: null }, effects: [] }
    }
  }
}

function mgmt(argv: string[]): PendingRun {
  return { kind: 'mgmt', argv, label: argv.slice(0, 2).join(' ') }
}

function wizardInput(owner: 'wizard-model' | 'wizard-key' | 'wizard-base', prompt: string, preset: string, masked = false): InputRequest {
  const model = emptyInput(masked)
  model.value = preset
  model.cursor = [...preset].length
  return { owner, prompt, model, preset }
}

// ---------- dialog routing ----------

function dialogKeyRouting(state: AppState, key: KeyEvent): { state: AppState; effects: Effect[] } {
  const dialog = state.dialog!
  if (key.name === 'escape' || isChar(key, 'q')) {
    return { state: { ...state, dialog: null, notice: t(state.lang, 'noticeCancelled') }, effects: [] }
  }
  if (key.name === 'left' || key.name === 'right' || key.name === 'tab') {
    return { state: { ...state, dialog: { ...dialog, confirmFocused: !dialog.confirmFocused } }, effects: [] }
  }
  if (key.name === 'enter') {
    if (!dialog.confirmFocused || !dialog.pending) return { state: { ...state, dialog: null }, effects: [] }
    return { state: { ...state, dialog: null }, effects: [{ type: 'run', run: dialog.pending }] }
  }
  return { state, effects: [] }
}

// ---------- wizard review ----------

function wizardReviewRouting(state: AppState, key: KeyEvent): { state: AppState; effects: Effect[] } {
  const wizard = state.wizard!
  if (key.name === 'escape') return { state: { ...state, wizard: null }, effects: [] }
  if (key.name !== 'enter') return { state, effects: [] }
  const summary = rootSummary(state)
  const input: WizardInput = {
    base: wizard.base,
    model: wizard.model,
    key: wizard.key,
    currentBase: summary?.config?.apiBase ?? '',
    currentModel: summary?.config?.model ?? '',
  }
  const result = validateWizard(input)
  if (!result.ok) {
    const message = result.error === 'invalidBase' ? t(state.lang, 'wizInvalidBase') : t(state.lang, 'wizInvalidKey')
    return { state: { ...state, wizard: { ...wizard, error: message } }, effects: [] }
  }
  return { state: { ...state, wizard: null }, effects: [{ type: 'wizard', input }] }
}

// ---------- screen routing ----------

function screenRouting(state: AppState, key: KeyEvent): { state: AppState; effects: Effect[] } {
  switch (state.screen) {
    case 'dashboard':
      return applyScreenResult(state, dashboardKey(state, key))
    case 'installer': {
      // PgUp/PgDn/g/G scroll the preview pane before row keys take over.
      const scrolled = paneScrollStep(state, key)
      if (scrolled) return { state: scrolled, effects: [] }
      const result = installerKey(state, key)
      const patch: Partial<AppState> = { ...result.patch }
      if ('dialog' in result) patch.dialog = result.dialog ?? null
      if (result.preview) patch.views = { ...state.views, installer: { lines: result.preview, offset: 0 } }
      let effects = result.effects
      // Landing on the status sub-tab autoloads `list` into the preview pane.
      const tab = patch.installer?.tab ?? state.installer.tab
      if (tab === 'status' && !state.autoloaded.installer) {
        const [effect] = autoloadEffects(state, 'installer')
        if (effect) {
          patch.autoloaded = { ...state.autoloaded, installer: true }
          effects = [...effects, effect]
        }
      }
      return { state: { ...state, ...patch }, effects }
    }
    case 'log':
      return { state: { ...state, views: { ...state.views, log: scrollStep(state, key) } }, effects: [] }
    case 'help': {
      const scrolled = paneScrollStep(state, key)
      return scrolled ? { state: scrolled, effects: [] } : { state, effects: [] }
    }
    default: {
      const scrolled = paneScrollStep(state, key)
      if (scrolled) return { state: scrolled, effects: [] }
      return listScreenKey(state, state.screen, key)
    }
  }
}

function applyScreenResult(state: AppState, result: { patch: Partial<AppState>; effects: Effect[] }): { state: AppState; effects: Effect[] } {
  return { state: { ...state, ...result.patch }, effects: result.effects }
}

function scrollStep(state: AppState, key: KeyEvent): { lines: string[]; offset: number } {
  const view = state.views.log ?? { lines: [], offset: 0 }
  const lines: string[] = state.receipts.flatMap((r) => [`❯ ${r.argv}`, ...r.output.map((l) => `  ${l}`), `  ↳ exit ${r.code}`, ''])
  const viewport = Math.max(3, state.height - 5)
  // Totals count FOLDED rows (SPEC 0011) so paging never dead-stops when raw
  // lines fit one screen but wrapped ones do not; render clamps to truth.
  const total = lines.reduce((sum, line) => sum + wrappedCount(line, Math.max(1, state.width - 4)), 0)
  if (key.name === 'up' || isChar(key, 'k')) return { ...view, offset: scrollBy(view.offset, -1, total, viewport) }
  if (key.name === 'down' || isChar(key, 'j')) return { ...view, offset: scrollBy(view.offset, 1, total, viewport) }
  if (isChar(key, 'g')) return { ...view, offset: 0 }
  if (isChar(key, 'G')) return { ...view, offset: STICKY_BOTTOM }
  if (key.name === 'pageup') return { ...view, offset: scrollBy(view.offset, -viewport, total, viewport) }
  if (key.name === 'pagedown') return { ...view, offset: scrollBy(view.offset, viewport, total, viewport) }
  return view
}

// ---------- pane scrolling for list + installer + help screens (SPEC 0011) ----------

/** Sticky-bottom sentinel: clamps to "last page" at render time. */
const STICKY_BOTTOM = 1_000_000

const SCROLLABLE_PANES: readonly ScreenId[] = ['guard', 'examine', 'optimize', 'set', 'installer', 'help']

/** Viewport of a scrollable pane at the current size (mirrors the renderers). */
function paneViewport(state: AppState): number {
  return Math.max(1, state.height - (state.screen === 'help' ? 3 : 5))
}

/** Folded row total of the screen's pane — same math the renderers use. */
function paneTotal(state: AppState): number {
  if (state.screen === 'help') return helpRowCount(state)
  // Installer splits 50/50, list screens 42/58 (same as the renderers).
  const ratio = state.screen === 'installer' ? 0.5 : 0.42
  const contentWidth = Math.max(1, splitWidth(state.width, ratio).right - 4)
  return (state.views[state.screen]?.lines ?? []).reduce((sum, line) => sum + wrappedCount(line, contentWidth), 0)
}

/** PgUp/PgDn/g/G scroll the current screen's pane; null = key not for panes. */
function paneScrollStep(state: AppState, key: KeyEvent): AppState | null {
  if (!SCROLLABLE_PANES.includes(state.screen)) return null
  const screen = state.screen
  const view = state.views[screen] ?? { lines: [], offset: 0 }
  // g/G use raw endpoints (0 / huge): render-time clamping keeps them honest
  // even when folding changes the total between keypress and paint.
  if (isChar(key, 'g')) return { ...state, ...patchOffset(state, screen, 0) }
  if (isChar(key, 'G')) return { ...state, ...patchOffset(state, screen, STICKY_BOTTOM) }
  let delta: number | null = null
  if (key.name === 'pageup') delta = -paneViewport(state)
  else if (key.name === 'pagedown') delta = paneViewport(state)
  if (delta === null) return null
  const offset = scrollBy(view.offset, delta, paneTotal(state), paneViewport(state))
  return { ...state, ...patchOffset(state, screen, offset) }
}

function patchOffset(state: AppState, screen: ScreenId, offset: number): Partial<AppState> {
  return { views: { ...state.views, [screen]: { lines: state.views[screen]?.lines ?? [], offset } } }
}

/** List-screen keys: cursor move (skipping group titles) + action activation. */
function listScreenKey(state: AppState, screen: ListScreen, key: KeyEvent): { state: AppState; effects: Effect[] } {
  const actions = listActions(state, screen)
  const cursor = settledCursor(actions, state.cursor[screen])
  if (key.name === 'up' || isChar(key, 'k')) return { state: { ...state, cursor: { ...state.cursor, [screen]: stepCursor(actions, cursor, -1) } }, effects: [] }
  if (key.name === 'down' || isChar(key, 'j')) return { state: { ...state, cursor: { ...state.cursor, [screen]: stepCursor(actions, cursor, 1) } }, effects: [] }
  if (key.name === 'enter' || key.name === 'space') {
    const action = actions[cursor]
    if (!action || action.header) return { state, effects: [] }
    if (action.wizard) return openWizard(state)
    if (action.ask) {
      return {
        state: {
          ...state,
          input: { owner: action.ask.owner, prompt: action.ask.prompt, model: presetModel(action.ask.preset ?? ''), preset: action.ask.preset },
        },
        effects: [],
      }
    }
    const run = action.run?.('')
    if (!run) return { state, effects: [] }
    if (action.danger) {
      const dialog: DialogState = {
        message: [dangerMessage(state.lang, action.id)],
        danger: true,
        confirmFocused: false,
        yesLabel: t(state.lang, 'confirmYes'),
        noLabel: t(state.lang, 'confirmNo'),
        pending: run,
      }
      return { state: { ...state, dialog }, effects: [] }
    }
    return { state, effects: [{ type: 'run', run }] }
  }
  return { state, effects: [] }
}

function dangerMessage(lang: Lang, actionId: string): string {
  if (actionId === 'clear-all') return t(lang, 'confirmClearAll')
  if (actionId === 'clear-key') return t(lang, 'confirmClearKey')
  return t(lang, 'confirmRollback')
}

function presetModel(preset: string): ReturnType<typeof emptyInput> {
  const model = emptyInput()
  model.value = preset
  model.cursor = [...preset].length
  return model
}

function openWizard(state: AppState): { state: AppState; effects: Effect[] } {
  const summary = rootSummary(state)
  const wizard = {
    step: 'base' as const,
    base: '',
    model: '',
    key: '',
    envWarning: summary?.keyEnvName && process.env[summary.keyEnvName] ? t(state.lang, 'wizEnvWarning', { name: summary.keyEnvName }) : undefined,
  }
  return {
    state: { ...state, wizard, input: wizardInput('wizard-base', t(state.lang, 'wizBase', { value: summary?.config?.apiBase ?? '' }), summary?.config?.apiBase ?? '') },
    effects: [],
  }
}

// ---------- rendering ----------

const NAV_TABS: readonly { screen: ScreenId; key: UiKeyLabel }[] = [
  { screen: 'dashboard', key: 'tabDashboard' },
  { screen: 'guard', key: 'tabGuard' },
  { screen: 'examine', key: 'tabExamine' },
  { screen: 'optimize', key: 'tabOptimize' },
  { screen: 'set', key: 'tabSet' },
  { screen: 'installer', key: 'tabInstaller' },
  { screen: 'log', key: 'tabLog' },
  { screen: 'help', key: 'tabHelp' },
]

type UiKeyLabel = Parameters<typeof t>[1]

/** Compose the full frame for the driver to paint. */
export function render(state: AppState): Row[] {
  const width = state.width
  const height = state.height
  const L = state.lang
  const summary = rootSummary(state)
  const hostLabel = visibleRoots(state).find((r) => r.root === state.currentRoot)?.label ?? (state.currentRoot ? '' : t(L, 'aggregate'))
  const chips = [
    { text: 'AUTO GUARD', style: theme.accentBg },
    { text: `v${tuiVersion()}`, style: theme.muted },
    ...(hostLabel ? [{ text: hostLabel, style: theme.bold }] : []),
    ...(state.currentRoot ? [{ text: tildeRoot(state.currentRoot), style: theme.muted }] : []),
    { text: L, style: theme.muted },
    ...(summary?.config ? [{ text: summary.config.enabled ? t(L, 'chipOn') : t(L, 'chipOff'), style: summary.config.enabled ? theme.okBg : theme.dangerBg }] : []),
  ]
  const tabs: NavTab[] = NAV_TABS.map((tab, i) => ({ label: t(L, tab.key), key: String(i + 1) }))
  const inputOpen = state.input !== null
  const bodyHeight = height - 3 - (inputOpen ? 1 : 0)
  const body = padFrame(renderBody(state, bodyHeight), width, bodyHeight)
  const frame: Row[] = [headerBar(width, chips), navTabs(width, tabs, SCREEN_ORDER.indexOf(state.screen)), ...body]
  if (state.dialog) {
    const overlaid = confirmDialog(frame.slice(2), width, state.dialog)
    frame.splice(2, overlaid.length, ...overlaid)
  }
  if (inputOpen) {
    const prompt = state.input!.owner === 'command' ? ':' : state.input!.prompt
    frame.push(inputRow(prompt, state.input!.model, width))
  }
  const busyLabel = state.busy ? t(L, (state.busy.busyKey ?? 'busyRun') as UiKeyLabel) : null
  const lastReceipt = state.receipts[state.receipts.length - 1]
  // Scrolling exists on list + help panes (SPEC 0011) — advertise it only
  // where the keys respond (dead keys stay silent and undocumented).
  const scrollAd = SCROLLABLE_PANES.includes(state.screen) ? [keyHint('PgUp/PgDn', t(L, 'hintScroll'))] : []
  const footerLeft: Row = state.notice
    ? [seg(' '), seg(`❯ ${state.notice}`, theme.accent)]
    : inputOpen
      ? hintRow([keyHint('Enter', t(L, 'hintSubmit')), keyHint('Esc', t(L, 'hintCancel'))])
      : state.busy
        ? hintRow([keyHint('q', t(L, 'hintQuit'))])
        : hintRow([
            keyHint('←→', t(L, 'hintScreens')),
            keyHint('↑↓', t(L, 'hintSelect')),
            keyHint('Enter', t(L, 'hintRun')),
            ...scrollAd,
            keyHint(':', t(L, 'hintCommand')),
            keyHint('r', t(L, 'hintRefresh')),
            keyHint('q', t(L, 'hintQuit')),
          ])
  frame.push(footerBar(width, footerLeft, lastReceipt ? { code: lastReceipt.code, argv: lastReceipt.argv } : null, busyLabel, state.tick))
  return padFrame(frame, width, height)
}

// ---------- brand banner (SPEC 0010) ----------

/** Banner needs room for the full 108-col wordmark + tagline + panels below. */
export function bannerBlock(state: AppState): Row[] {
  if (state.width < 110 || state.height < 20) return []
  const rows: Row[] = renderBannerGrid().map((line, i): Row => [seg(line, { fg256: GRADIENT[Math.min(i, GRADIENT.length - 1)] })])
  rows.push([seg(` auto-guard v${tuiVersion()} · ${t(state.lang, 'tagline')}`, theme.muted)])
  rows.push([seg('')])
  return rows
}

/** Header + tab row + footer chrome rows that surround the body. */
const CHROME_ROWS = 3

function renderBody(state: AppState, bodyHeight: number): Row[] {
  if (state.screen === 'dashboard') {
    const banner = bannerBlock(state)
    const bodyState: AppState = { ...state, height: bodyHeight + CHROME_ROWS - banner.length }
    return [...banner, ...renderDashboard(bodyState)]
  }
  const bodyState: AppState = { ...state, height: bodyHeight + CHROME_ROWS }
  switch (state.screen) {
    case 'installer':
      return renderInstaller(bodyState)
    case 'log':
      return renderLog(bodyState)
    case 'help':
      return renderHelp(bodyState)
    case 'set': {
      // While the wizard sits at its review step, its masked summary (or the
      // validation error) leads the screen.
      if (state.wizard && !state.input) {
        const lead: Row = state.wizard.error
          ? [seg(state.wizard.error, theme.danger)]
          : [seg(wizardReviewLine(state), theme.warn)]
        const rest = renderListScreen(bodyState, 'set')
        return [[...lead, seg('  '), ...keyHint('Esc', t(state.lang, 'hintCancel'))], ...rest]
      }
      return renderListScreen(bodyState, 'set')
    }
    default:
      return renderListScreen(bodyState, state.screen)
  }
}

/** Wizard review line (masked) for the set screen's status strip. */
export function wizardReviewLine(state: AppState): string {
  const wizard = state.wizard!
  const summary = rootSummary(state)
  return t(state.lang, 'wizReview', {
    base: wizard.base || summary?.config?.apiBase || '',
    model: wizard.model || summary?.config?.model || '',
    masked: maskKey(wizard.key.trim()),
  })
}
