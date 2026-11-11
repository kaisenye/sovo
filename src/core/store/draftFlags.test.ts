import { describe, expect, it } from 'vitest'
import { draftFlagsRead } from './repo.js'

describe('draftFlagsRead', () => {
  it('adds \\Seen to a local draft with no flags', () => {
    expect(JSON.parse(draftFlagsRead('[]'))).toEqual(['\\Seen'])
    expect(JSON.parse(draftFlagsRead(null))).toEqual(['\\Seen'])
  })
  it('keeps other flags and leaves read drafts as they are', () => {
    expect(JSON.parse(draftFlagsRead('["\\\\Draft"]'))).toEqual(['\\Draft', '\\Seen'])
    expect(draftFlagsRead('["\\\\Seen","\\\\Draft"]')).toBe('["\\\\Seen","\\\\Draft"]')
  })
  it('survives unreadable flags', () => {
    expect(JSON.parse(draftFlagsRead('not json'))).toEqual(['\\Seen'])
  })
})
