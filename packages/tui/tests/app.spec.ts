import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { defaultGuardConfig, type GuardConfig } from '@auto-guard/core'
import { dashboardKey } from '../src/screens/dashboard.ts'
import { reduce } from '../src/app.ts'
import { render } from '../src/app.ts'
import { t } from '../src/i18n.ts'
import type { AppState, DialogState, PendingRun, WizardState } from '../src/types.ts'
import type { KeyEvent } from '../src/keys.ts'

const root = join('C:', 'tmp', '.zcode', 'auto-guard')

function config(over: Partial<GuardConfig> = {}): GuardConfig {
  return { ...defaultGuardConfig(root), enabled: true, apiBase: 'https://api.local', model: 'deepseek-chat', ...over }
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    screen: 'dashboard',
    width: 100,
    height: 30,
    lang: 'zh',
    roots: [
      {
        hostId: 'zcode',
        label: 'ZCode',
        homeDir: join('C:', 'tmp', '.zcode'),
        root,
        installed: true,
        seeded: true,
        config: config(),
        status: {},
        keyStored: false,
        keyEnvName: 'DEEPSEEK_API_KEY',
      },
    ],
    currentRoot: root,
    focusRoot: 0,
    cursor: {},
    views: {},
    installer: {
      tab: 'init',
      cursor: 0,
      checked: {},
      rulesChoice: 'skip',
      langAsked: false,
      detections: [],
      preview: [],
      removeChecked: {},
    },
    wizard: null,
    input: null,
    dialog: null,
    busy: null,
    receipts: [],
    tick: 0,
    exitAfterBusies: false,
    ...over,
  }
}

const key = (name: string, ch?: string): KeyEvent => ({ name: name as KeyEvent['name'], ch })

describe('global keys', () => {
  it('q quits, digits switch screens with refresh', () => {
    expect(reduce(state(), { type: 'key', key: key('char', 'q') }).effects).toEqual([{ type: 'quit' }])
    const switched = reduce(state(), { type: 'key', key: key('char', '3') })
    expect(switched.state.screen).toBe('examine')
    expect(switched.effects).toEqual([{ type: 'refresh' }])
  })

  it('busy swallows every key except quit', () => {
    const busyState = state({ busy: { kind: 'mgmt', argv: ['guard', 'ping'], label: 'ping' } })
    expect(reduce(busyState, { type: 'key', key: key('char', '5') }).state.screen).toBe('dashboard')
    expect(reduce(busyState, { type: 'key', key: key('char', 'q') }).effects).toEqual([{ type: 'quit' }])
  })
})

describe(': command mode', () => {
  it('runs management argv through the current root', () => {
    let s = reduce(state(), { type: 'key', key: key('char', ':') }).state
    expect(s.input?.owner).toBe('command')
    for (const ch of 'guard status') s = reduce(s, { type: 'key', key: key('char', ch) }).state
    const done = reduce(s, { type: 'key', key: key('enter') })
    expect(done.state.input).toBeNull()
    expect(done.effects).toEqual([{ type: 'run', run: { kind: 'mgmt', argv: ['guard', 'status'], label: 'guard status' } }])
  })

  it('routes installer verbs to the installer seam', () => {
    let s = reduce(state(), { type: 'key', key: key('char', ':') }).state
    for (const ch of 'init list') s = reduce(s, { type: 'key', key: key('char', ch) }).state
    const done = reduce(s, { type: 'key', key: key('enter') })
    expect(done.effects[0]).toMatchObject({ type: 'run', run: { kind: 'inst', argv: ['init', 'list'] } })
  })
})

describe('run-done', () => {
  it('records the receipt, sticks the view to the bottom and refreshes', () => {
    const done = reduce(state({ busy: { kind: 'mgmt', argv: ['guard', 'status'], label: 's' } }), {
      type: 'run-done',
      receipt: { id: 1, argv: 'guard status', code: 0, output: ['line1', 'line2'] },
    })
    expect(done.state.busy).toBeNull()
    expect(done.state.receipts).toHaveLength(1)
    expect(done.state.views.dashboard!.lines[0]).toBe('❯ guard status')
    expect(done.state.views.dashboard!.offset).toBeGreaterThan(1000)
    expect(done.effects).toEqual([{ type: 'refresh' }])
  })
})

describe('confirm dialog', () => {
  const pending: PendingRun = { kind: 'mgmt', argv: ['examine', 'clear-all'], label: 'examine clear-all' }
  const dialog: DialogState = {
    message: [t('zh', 'confirmClearAll')],
    danger: true,
    confirmFocused: false,
    yesLabel: t('zh', 'confirmYes'),
    noLabel: t('zh', 'confirmNo'),
    pending,
  }

  it('toggles focus and runs only on confirm', () => {
    const s = state({ dialog })
    const toggled = reduce(s, { type: 'key', key: key('left') }).state
    expect(toggled.dialog?.confirmFocused).toBe(true)
    const confirmed = reduce(toggled, { type: 'key', key: key('enter') })
    expect(confirmed.state.dialog).toBeNull()
    expect(confirmed.effects).toEqual([{ type: 'run', run: pending }])
    const cancelled = reduce(s, { type: 'key', key: key('escape') })
    expect(cancelled.state.dialog).toBeNull()
    expect(cancelled.effects).toEqual([])
  })
})

describe('set-key wizard review', () => {
  const wizard: WizardState = { step: 'review', base: '', model: '', key: 'sk-valid-key' }

  it('Enter with a valid key emits the wizard save effect', () => {
    const done = reduce(state({ screen: 'set', wizard }), { type: 'key', key: key('enter') })
    expect(done.state.wizard).toBeNull()
    expect(done.effects[0]?.type).toBe('wizard')
  })

  it('invalid base keeps the wizard with an error', () => {
    const done = reduce(state({ screen: 'set', wizard: { ...wizard, base: 'ftp://bad' } }), { type: 'key', key: key('enter') })
    expect(done.state.wizard?.error).toBe(t('zh', 'wizInvalidBase'))
    expect(done.effects).toEqual([])
  })
})

describe('list screen actions', () => {
  it('guard toggle reflects config state and runs the opposite', () => {
    const s = state({ screen: 'guard' })
    const entered = reduce(s, { type: 'key', key: key('enter') })
    expect(entered.effects[0]).toMatchObject({ type: 'run', run: { argv: ['guard', 'off'] } })
    const disabled = reduce(state({ screen: 'guard', roots: [{ ...s.roots[0]!, config: config({ enabled: false }) }] }), { type: 'key', key: key('enter') })
    expect(disabled.effects[0]).toMatchObject({ type: 'run', run: { argv: ['guard', 'on'] } })
  })

  it('dangerous actions require the dialog first', () => {
    let s = state({ screen: 'examine' })
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'key', key: key('down') }).state // cursor on clear-all (index 3)
    const entered = reduce(s, { type: 'key', key: key('enter') })
    expect(entered.effects).toEqual([])
    expect(entered.state.dialog?.pending?.argv).toEqual(['examine', 'clear-all'])
  })

  it('set-key opens the wizard with the base prompt preset', () => {
    let s = state({ screen: 'set' })
    s = reduce(s, { type: 'key', key: key('down') }).state // cursor on set-key
    const entered = reduce(s, { type: 'key', key: key('enter') })
    expect(entered.state.wizard?.step).toBe('base')
    expect(entered.state.input?.owner).toBe('wizard-base')
    expect(entered.state.input?.model.value).toBe('https://api.local')
  })
})

describe('render', () => {
  it('composes a full frame with header/nav/footer at any size', () => {
    const frame = render(state({ width: 100, height: 30 }))
    expect(frame).toHaveLength(30)
    const plain = frame.map((row) => row.map((s) => s.text).join(''))
    expect(plain[1]).toContain('总览')
    expect(plain[2]!.length).toBeGreaterThan(0)
    expect(plain[29]).toContain('q')
  })
})

describe('dashboard keys', () => {
  it('Enter selects the focused seeded root and refreshes', () => {
    const result = dashboardKey(state(), { name: 'enter' })
    expect(result.patch.currentRoot).toBe(root)
    expect(result.effects).toEqual([{ type: 'refresh' }])
  })

  it('p pings the focused root with an explicit --config-root', () => {
    const result = dashboardKey(state(), { name: 'char', ch: 'p' })
    expect(result.effects[0]).toMatchObject({
      type: 'run',
      run: { kind: 'mgmt', argv: ['guard', 'ping', '--config-root', root] },
    })
  })
})
