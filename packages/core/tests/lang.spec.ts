import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCatalog, envLang, interpolate, langOf, normalizeLang } from '../src/lang.ts'
import { effectiveLang, machineConfigPath, readMachineLang, writeMachineLang } from '../src/machine-config.ts'

describe('normalizeLang', () => {
  it('accepts zh/en with regional tags, case-insensitively', () => {
    expect(normalizeLang('zh')).toBe('zh')
    expect(normalizeLang('zh-CN')).toBe('zh')
    expect(normalizeLang('EN')).toBe('en')
    expect(normalizeLang(' en-US ')).toBe('en')
  })

  it('rejects empty and unknown values', () => {
    expect(normalizeLang(undefined)).toBeUndefined()
    expect(normalizeLang('')).toBeUndefined()
    expect(normalizeLang('fr')).toBeUndefined()
    expect(normalizeLang('deutsch')).toBeUndefined()
  })
})

describe('envLang', () => {
  it('reads AUTO_GUARD_LANG through the injected env', () => {
    expect(envLang({ AUTO_GUARD_LANG: 'en' })).toBe('en')
    expect(envLang({ AUTO_GUARD_LANG: 'zh-CN' })).toBe('zh')
    expect(envLang({})).toBeUndefined()
    expect(envLang({ AUTO_GUARD_LANG: 'fr' })).toBeUndefined()
  })
})

describe('effectiveLang: four-layer resolution (ADR-0011)', () => {
  it('resolves env > config > machine > zh in order', () => {
    expect(effectiveLang({ env: 'en', configLang: 'zh', machineLang: 'zh' })).toBe('en')
    expect(effectiveLang({ env: undefined, configLang: 'en', machineLang: 'zh' })).toBe('en')
    expect(effectiveLang({ env: undefined, configLang: undefined, machineLang: 'en' })).toBe('en')
    expect(effectiveLang({})).toBe('zh')
  })

  it('lets the machine default beat the zh fallback but never an explicit config', () => {
    expect(effectiveLang({ configLang: 'zh', machineLang: 'en' })).toBe('zh')
    expect(effectiveLang({ machineLang: 'zh' })).toBe('zh')
  })
})

describe('machine default file', () => {
  const dirs: string[] = []
  function temp(): string {
    const d = mkdtempSync(join(tmpdir(), 'ag-machine-'))
    dirs.push(d)
    return d
  }
  it('lives at <home>/.auto-guard/config.json', () => {
    expect(machineConfigPath(join('C:', 'users', 'me'))).toBe(join('C:', 'users', 'me', '.auto-guard', 'config.json'))
  })

  it('round-trips a language and preserves unrelated fields', () => {
    const file = join(temp(), 'config.json')
    writeFileSync(file, JSON.stringify({ lang: 'zh', theme: 'dark' }), 'utf8')
    writeMachineLang(file, 'en')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lang: 'en', theme: 'dark' })
    expect(readMachineLang(file)).toBe('en')
  })

  it('ignores unknown fields, invalid lang values and unparseable files', () => {
    const dir = temp()
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify({ somethingElse: 1 }), 'utf8')
    expect(readMachineLang(file)).toBeUndefined()
    writeFileSync(file, JSON.stringify({ lang: 'fr' }), 'utf8')
    expect(readMachineLang(file)).toBeUndefined()
    writeFileSync(file, '{not json', 'utf8')
    expect(readMachineLang(file)).toBeUndefined()
    expect(readMachineLang(join(dir, 'missing.json'))).toBeUndefined()
  })

  it('starts a fresh file when none exists', () => {
    const dir = temp()
    const file = join(dir, '.auto-guard', 'config.json')
    writeMachineLang(file, 'en')
    expect(readMachineLang(file)).toBe('en')
  })

  it('replaces an unparseable file rather than refusing to remember', () => {
    const file = join(temp(), 'config.json')
    writeFileSync(file, 'garbage', 'utf8')
    writeMachineLang(file, 'zh')
    expect(readMachineLang(file)).toBe('zh')
  })

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })
})

describe('defineCatalog + langOf', () => {
  const catalog = defineCatalog({ greet: '你好 {name}', bye: '再见' }, { greet: 'hello {name}', bye: 'bye' })

  it('interpolates params and passes unknown placeholders through', () => {
    expect(catalog.message('en', 'greet', { name: 'pi' })).toBe('hello pi')
    expect(catalog.message('zh', 'greet', { name: 'pi' })).toBe('你好 pi')
    expect(catalog.message('en', 'greet', { other: 1 })).toBe('hello {name}')
    expect(interpolate('{n} of {n}', { n: 3 })).toBe('3 of 3')
  })

  it('falls back to zh wording for zh and en wording for en', () => {
    expect(catalog.message('zh', 'bye')).toBe('再见')
    expect(catalog.message('en', 'bye')).toBe('bye')
  })

  it('langOf reads the config field with a zh default', () => {
    expect(langOf({})).toBe('zh')
    expect(langOf({ lang: 'en' })).toBe('en')
  })
})
