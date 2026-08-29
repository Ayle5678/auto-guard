import { describe, expect, it } from 'vitest'
import { resolveUiLang, t } from '../src/i18n.ts'

describe('TUI catalog', () => {
  it('interpolates params', () => {
    expect(t('zh', 'dashExamine', { count: 12 })).toBe('审计 12')
    expect(t('en', 'dashExamine', { count: 12 })).toBe('audit 12')
  })

  it('resolves language via env > machine > zh with the same seam as the CLI', () => {
    expect(resolveUiLang({ env: { AUTO_GUARD_LANG: 'en' } })).toBe('en')
    expect(resolveUiLang({ env: {}, configLang: 'en' })).toBe('en')
    expect(resolveUiLang({ env: {}, machineLangPath: 'Z:/nonexistent-machine-lang/config.json' })).toBe('zh')
  })
})
