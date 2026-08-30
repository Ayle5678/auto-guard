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
    autoloaded: {},
    tick: 0,
    exitAfterBusies: false,
    ...over,
  }
}

const key = (name: string, ch?: string): KeyEvent => ({ name: name as KeyEvent['name'], ch })

describe('global keys', () => {
  it('q quits, digits jump to a screen with refresh + first-visit autoload', () => {
    expect(reduce(state(), { type: 'key', key: key('char', 'q') }).effects).toEqual([{ type: 'quit' }])
    const switched = reduce(state(), { type: 'key', key: key('char', '3') })
    expect(switched.state.screen).toBe('examine')
    expect(switched.effects[0]).toEqual({ type: 'refresh' })
    expect(switched.effects[1]).toMatchObject({ type: 'autoload', screen: 'examine', run: { argv: ['examine', 'status'] } })
    expect(switched.state.autoloaded.examine).toBe(true)
  })

  it('busy swallows every key except quit', () => {
    const busyState = state({ busy: { kind: 'mgmt', argv: ['guard', 'ping'], label: 'ping' } })
    expect(reduce(busyState, { type: 'key', key: key('char', '5') }).state.screen).toBe('dashboard')
    expect(reduce(busyState, { type: 'key', key: key('char', 'q') }).effects).toEqual([{ type: 'quit' }])
  })
})

describe('arrow-key screen switching (SPEC 0010)', () => {
  it('right/left move across SCREEN_ORDER with wrap-around', () => {
    const right = reduce(state(), { type: 'key', key: key('right') })
    expect(right.state.screen).toBe('guard')
    const left = reduce(state(), { type: 'key', key: key('left') })
    expect(left.state.screen).toBe('help')
    expect(left.effects[0]).toEqual({ type: 'refresh' })
    const h = reduce(state({ screen: 'log' }), { type: 'key', key: key('char', 'h') })
    expect(h.state.screen).toBe('installer')
  })

  it('leaves installer sub-tabs to the Tab key', () => {
    const switched = reduce(state({ screen: 'installer' }), { type: 'key', key: key('right') })
    expect(switched.state.screen).toBe('log')
    expect(switched.state.installer.tab).toBe('init')
  })

  it('digits keep the seeded-root autoload: guard screen autoloads recent 10', () => {
    const switched = reduce(state(), { type: 'key', key: key('char', '2') })
    expect(switched.effects[1]).toMatchObject({ type: 'autoload', screen: 'guard', run: { argv: ['guard', 'recent', '10'] } })
  })
})

describe('notice (SPEC 0010)', () => {
  it('shows a notice on switch and clears it on the next key', () => {
    const switched = reduce(state(), { type: 'key', key: key('right') })
    expect(switched.state.notice).toContain('守卫')
    const next = reduce(switched.state, { type: 'key', key: key('down') })
    expect(next.state.notice).toBeUndefined()
  })

  it('shows 已刷新 on r and re-runs the autoload', () => {
    const visited = reduce(state(), { type: 'key', key: key('char', '2') }).state
    const refreshed = reduce({ ...visited, screen: 'guard' }, { type: 'key', key: key('char', 'r') })
    expect(refreshed.state.notice).toBe(t('zh', 'noticeRefresh'))
    expect(refreshed.effects.some((effect) => effect.type === 'autoload')).toBe(true)
  })

  it('dialog escape raises the cancelled notice', () => {
    const dialog: DialogState = {
      message: ['x'],
      danger: true,
      confirmFocused: false,
      yesLabel: '确认',
      noLabel: '取消',
      pending: { kind: 'mgmt', argv: ['examine', 'clear-all'], label: 'examine clear-all' },
    }
    const cancelled = reduce(state({ dialog }), { type: 'key', key: key('escape') })
    expect(cancelled.state.notice).toBe(t('zh', 'noticeCancelled'))
  })
})

describe('autoload (SPEC 0010)', () => {
  it('autoload-done fills the screen view without touching receipts', () => {
    const visited = reduce(state({ screen: 'guard' }), { type: 'key', key: key('char', '2') })
    const done = reduce({ ...visited.state, busy: { kind: 'mgmt', argv: ['guard', 'recent', '10'], label: 'guard recent 10' } }, {
      type: 'autoload-done',
      screen: 'guard',
      receipt: { id: 1, argv: 'guard recent 10', code: 0, output: ['decision 1'] },
    })
    expect(done.state.busy).toBeNull()
    expect(done.state.receipts).toHaveLength(0)
    expect(done.state.views.guard!.lines).toContain('❯ guard recent 10')
    expect(done.state.views.guard!.lines.join('\n')).toContain('decision 1')
  })

  it('REGRESSION: sticky-bottom offset renders, never slices to empty (0009 bug)', () => {
    const visited = reduce(state({ screen: 'guard' }), { type: 'key', key: key('char', '2') }).state
    const done = reduce({ ...visited, busy: null }, {
      type: 'autoload-done',
      screen: 'guard',
      receipt: { id: 1, argv: 'guard recent 10', code: 0, output: ['RECENT-VISIBLE-LINE'] },
    }).state
    const plain = render(done).map((row) => row.map((s) => s.text).join('')).join('\n')
    expect(plain).toContain('RECENT-VISIBLE-LINE')
    expect(plain).toContain('↳ exit 0')
  })

  it('second visit does not re-autoload', () => {
    const first = reduce(state(), { type: 'key', key: key('char', '2') }).state // → guard, autoload
    const away = reduce(first, { type: 'key', key: key('char', '1') }).state // → dashboard
    const back = reduce(away, { type: 'key', key: key('char', '2') }) // → guard again
    expect(back.effects.every((effect) => effect.type !== 'autoload')).toBe(true)
  })

  it('screens without a seeded root skip the autoload', () => {
    const bare = state({ roots: [] })
    const switched = reduce(bare, { type: 'key', key: key('char', '2') })
    expect(switched.effects).toEqual([{ type: 'refresh' }])
  })

  it('dashboard, log and help never autoload', () => {
    for (const screen of ['dashboard', 'log', 'help'] as const) {
      const refreshed = reduce({ ...state({ screen }), autoloaded: {} }, { type: 'key', key: key('char', 'r') })
      expect(refreshed.effects).toEqual([{ type: 'refresh' }])
    }
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
    expect(result.patch.notice).toContain('ZCode')
  })

  it('p pings the focused root with an explicit --config-root', () => {
    const result = dashboardKey(state(), { name: 'char', ch: 'p' })
    expect(result.effects[0]).toMatchObject({
      type: 'run',
      run: { kind: 'mgmt', argv: ['guard', 'ping', '--config-root', root] },
    })
  })
})

describe('brand + chrome rendering (SPEC 0010)', () => {
  const plainOf = (frame: ReturnType<typeof render>): string => frame.map((row) => row.map((s) => s.text).join('')).join('\n')

  it('wide terminals (>=110 cols) show the AUTO GUARD wordmark and tagline', () => {
    const plain = plainOf(render(state({ width: 120, height: 30 })))
    expect(plain).toContain('████╗')
    expect(plain).toContain('auto-guard v')
    expect(plain).toContain('守卫控制台')
  })

  it('narrower or short terminals drop the banner and keep the frame bounded', () => {
    for (const [width, height] of [[100, 30], [40, 12], [120, 19]] as const) {
      const frame = render(state({ width, height }))
      expect(plainOf(frame)).not.toContain('████╗')
      expect(frame).toHaveLength(height)
    }
  })

  it('header carries the brand chip and version', () => {
    const plain = plainOf(render(state({ width: 100, height: 30 })))
    expect(plain.split('\n')[0]).toContain('AUTO GUARD')
    expect(plain.split('\n')[0]).toContain('v')
  })

  it('footer hints lead with arrows; notice takes the left slot', () => {
    const plain = plainOf(render(state({ width: 100, height: 30 })))
    expect(plain).toContain('切屏')
    expect(plain).not.toContain('1-8 切屏')
    const noticed = plainOf(render(state({ width: 100, height: 30, notice: '→ 守卫' })))
    expect(noticed).toContain('❯ → 守卫')
  })

  it('help screen documents the new bindings', () => {
    const plain = plainOf(render(state({ screen: 'help', width: 100, height: 30 })))
    expect(plain).toContain('switch screen')
    expect(plain).toContain('Tab / Shift+Tab')
    expect(plain).toContain('jump to screen')
  })

  it('list screens render status + actions panels on the left', () => {
    const plain = plainOf(render(state({ screen: 'examine', width: 100, height: 30 })))
    expect(plain).toContain('状态')
    expect(plain).toContain('动作')
    expect(plain).toContain('输出')
    expect(plain).toContain('⚠ 清空审计')
  })
})
