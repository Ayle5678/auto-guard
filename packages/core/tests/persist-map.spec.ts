import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileJsonSink, PersistableMap, memorySink } from '../src/persist-map.ts'

describe('PersistableMap', () => {
  it('behaves like a Map when no sink is provided', () => {
    const map = new PersistableMap<number>()
    map.set('a', 1)
    expect(map.get('a')).toBe(1)
    expect(map.has('a')).toBe(true)
    expect(map.size).toBe(1)
    map.delete('a')
    expect(map.size).toBe(0)
  })

  it('mirrors mutations into the sink', () => {
    const store: Record<string, unknown> = {}
    const map = new PersistableMap<number>(memorySink(store))
    map.set('a', 1)
    map.set('b', 2)
    map.delete('a')
    expect(store).toEqual({ b: 2 })
    map.clear()
    expect(store).toEqual({})
  })

  it('hydrates from a pre-populated sink (process restart simulation)', () => {
    const store: Record<string, unknown> = { deniedCmd: { deniedAt: 42 } }
    const revived = new PersistableMap<{ deniedAt: number }>(memorySink(store))
    expect(revived.get('deniedCmd')).toEqual({ deniedAt: 42 })
  })

  it('keeps keys() order for prefix scans', () => {
    const map = new PersistableMap<string>()
    map.set('s1|a', 'x')
    map.set('s2|b', 'y')
    expect([...map.keys()].filter((k) => k.startsWith('s1|'))).toEqual(['s1|a'])
  })
})

describe('FileJsonSink', () => {
  it('round-trips data through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-sink-'))
    const path = join(dir, 'pending.json')
    const sink = new FileJsonSink(path)
    sink.write({ cmd: { n: 1 } })
    expect(new FileJsonSink(path).read()).toEqual({ cmd: { n: 1 } })
    expect(readFileSync(path, 'utf8').trim().length).toBeGreaterThan(0)
  })

  it('returns {} for missing or corrupt files and survives unwritable paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-sink-'))
    expect(new FileJsonSink(join(dir, 'missing.json')).read()).toEqual({})

    const corruptPath = join(dir, 'corrupt.json')
    writeFileSync(corruptPath, '{not json')
    expect(new FileJsonSink(corruptPath).read()).toEqual({})

    // Writing to a path whose parent is a file must not throw.
    expect(() => new FileJsonSink(corruptPath + '/child/x.json').write({})).not.toThrow()
  })
})
