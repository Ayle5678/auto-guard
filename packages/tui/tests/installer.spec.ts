import { describe, expect, it } from 'vitest'
import { installerKey, installerRows } from '../src/screens/installer.ts'
import type { AppState } from '../src/types.ts'

function baseState(over: Partial<AppState> = {}): AppState {
  return {
    screen: 'installer',
    width: 100,
    height: 30,
    lang: 'zh',
    roots: [],
    currentRoot: '',
    focusRoot: 0,
    cursor: {},
    views: {},
    installer: {
      tab: 'init',
      cursor: 1,
      checked: {},
      rulesChoice: 'skip',
      langAsked: false,
      detections: [
        {
          profile: { id: 'zcode', label: 'ZCode' } as never,
          detected: true,
          evidence: ['~/.zcode 存在'],
          confidence: 'high',
          integrated: 'not-integrated',
        },
        {
          profile: { id: 'dsh', label: 'DSH' } as never,
          detected: true,
          evidence: ['~/.dsh 存在'],
          confidence: 'high',
          integrated: 'integrated',
        },
        {
          profile: { id: 'pi', label: 'Pi' } as never,
          detected: false,
          evidence: [],
          confidence: 'none',
          integrated: 'not-integrated',
        },
      ],
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

describe('installer rows', () => {
  it('locks integrated and undetected hosts; detected hosts stay checkable', () => {
    const rows = installerRows(baseState())
    const hostRows = rows.filter((r) => r.kind === 'host')
    expect(hostRows.map((r) => r.locked)).toEqual([false, true, true])
    expect(rows.at(-1)!.kind).toBe('apply')
  })

  it('remove tab lists only integrated hosts', () => {
    const rows = installerRows(baseState({ installer: { ...baseState().installer, tab: 'remove' } }))
    expect(rows.filter((r) => r.kind === 'remove-host')).toHaveLength(1)
    expect(rows.at(-1)!.kind).toBe('remove-apply')
  })
})

describe('installer keys', () => {
  it('Space toggles host selection', () => {
    const result = installerKey(baseState(), { name: 'space' })
    expect(result.patch.installer?.checked).toEqual({ zcode: true })
  })

  it('apply without selection shows the hint instead of a dialog', () => {
    const result = installerKey({ ...baseState(), installer: { ...baseState().installer, cursor: 6 } }, { name: 'enter' })
    expect(result.dialog).toBeUndefined()
    expect(result.patch.views?.installer?.lines).toEqual(['请先勾选至少一个宿主'])
  })

  it('apply with selection produces preview + confirm dialog with canonical argv', () => {
    const withCheck = baseState()
    withCheck.installer.checked = { zcode: true }
    withCheck.installer.cursor = 6
    const result = installerKey(withCheck, { name: 'enter' })
    expect(result.preview?.length).toBeGreaterThan(0)
    expect(result.dialog?.pending?.argv).toEqual(['init', '--host', 'zcode', '--skip-rules', '--yes', '--lang', 'zh'])
  })

  it('rules radio switches the choice', () => {
    const s = baseState()
    s.installer.rulesChoice = 'skip'
    // cursor 1 is the zcode host row; rules rows sit after the 3 hosts.
    const onRules = installerKey({ ...s, installer: { ...s.installer, cursor: 4 } }, { name: 'space' })
    expect(onRules.patch.installer?.rulesChoice).toBe('update')
  })

  it('tabs cycle with wrap-around', () => {
    const right = installerKey(baseState(), { name: 'right' })
    expect(right.patch.installer?.tab).toBe('status')
    const leftFromInit = installerKey(baseState(), { name: 'left' })
    expect(leftFromInit.patch.installer?.tab).toBe('remove')
  })
})

describe('remove flow', () => {
  it('remove-apply opens a danger dialog with the ordered argv', () => {
    const s = baseState()
    s.installer.tab = 'remove'
    s.installer.removeChecked = { dsh: true }
    // remove tab rows: one integrated host (dsh) + apply
    const result = installerKey({ ...s, installer: { ...s.installer, cursor: 1 } }, { name: 'enter' })
    expect(result.dialog?.danger).toBe(true)
    expect(result.dialog?.pending?.argv).toEqual(['remove', '--host', 'dsh', '--yes'])
  })
})
