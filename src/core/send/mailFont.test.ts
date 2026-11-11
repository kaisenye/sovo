import { describe, expect, it } from 'vitest'
import { MAIL_FONT_STYLE, withMailFont } from './mailFont.js'

describe('withMailFont', () => {
  it('wraps the body in sans-serif 12px once', () => {
    const once = withMailFont('<div>Hi</div>')
    expect(once).toBe(`<div style="${MAIL_FONT_STYLE}"><div>Hi</div></div>`)
    expect(withMailFont(once)).toBe(once)
    expect(MAIL_FONT_STYLE).toContain('font-family:sans-serif')
    expect(MAIL_FONT_STYLE).toContain('font-size:12px')
  })
  it('leaves an empty body empty', () => {
    expect(withMailFont('')).toBe('')
  })
})
