import { describe, expect, it } from 'vitest'
import { addEntries, entryLabel, joinEntries, looksLikeAddress, readLine, splitEntries } from './recipients.js'

describe('recipients', () => {
  it('splits a line on commas and semicolons', () => {
    expect(splitEntries('Ann <ann@x.io>; bob@y.io,  , ')).toEqual(['Ann <ann@x.io>', 'bob@y.io'])
  })

  it('labels a pill by name, else by address', () => {
    expect(entryLabel('Kaisen Ye <kaisen@hippsc.com>')).toBe('Kaisen Ye')
    expect(entryLabel('"Ann" <ann@x.io>')).toBe('Ann')
    expect(entryLabel('Bob@Y.io')).toBe('bob@y.io')
  })

  it('marks entries that will not send', () => {
    expect(looksLikeAddress('Ann <ann@x.io>')).toBe(true)
    expect(looksLikeAddress('ann')).toBe(false)
    expect(looksLikeAddress('ann@x')).toBe(false)
  })

  it('joins pills and the text being typed', () => {
    expect(joinEntries(['a@x.io', 'b@y.io'], ' c ')).toBe('a@x.io, b@y.io, c')
    expect(joinEntries([], '')).toBe('')
  })

  it('adds without duplicating an address', () => {
    expect(addEntries(['Ann <ann@x.io>'], ['ANN@x.io', 'bob@y.io', 'bob@y.io'])).toEqual(['Ann <ann@x.io>', 'bob@y.io'])
  })

  it('reads its own draft back, and treats any other value as pills', () => {
    expect(readLine('a@x.io, bo', 'bo')).toEqual({ pills: ['a@x.io'], draft: 'bo' })
    expect(readLine('Ann <ann@x.io>', '')).toEqual({ pills: ['Ann <ann@x.io>'], draft: '' })
    expect(readLine('Ann <ann@x.io>, bob@y.io', 'zed')).toEqual({ pills: ['Ann <ann@x.io>', 'bob@y.io'], draft: '' })
  })
})
