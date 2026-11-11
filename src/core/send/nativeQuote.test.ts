import { describe, expect, it } from 'vitest'
import { nativeQuote, quoteStyleFor } from './nativeQuote.js'

const draft =
  '<p>Sounds good</p><div class="sovo-signature"><p>Kai</p></div>' +
  '<div class="sovo-quote"><p>On Tue, Nov 3, 2026, 2:42 PM, Ana &lt;ana@x.com&gt; wrote:</p>' +
  '<blockquote style="margin:0"><p>Dinner?</p><blockquote><p>older</p></blockquote></blockquote></div>'

const header = {
  from_addr: 'ana@x.com',
  from_name: 'Ana Lima',
  to_addrs: 'kai@hippsc.com',
  date: Date.UTC(2026, 10, 3, 22, 42),
  subject: 'Dinner'
}

describe('quoteStyleFor', () => {
  it('uses Exmail markup for Tencent hosts only', () => {
    expect(quoteStyleFor('imap.exmail.qq.com')).toBe('exmail')
    expect(quoteStyleFor('imap.qq.com')).toBe('exmail')
    expect(quoteStyleFor('imap.gmail.com')).toBe('gmail')
    expect(quoteStyleFor('outlook.office365.com')).toBe('gmail')
    expect(quoteStyleFor('notqq.com')).toBe('gmail')
  })
})

describe('nativeQuote', () => {
  it('writes Gmail quote markup and drops every marker', () => {
    const out = nativeQuote(draft, 'gmail')
    expect(out).toContain('<div class="gmail_quote gmail_quote_container">')
    expect(out).toContain('<div dir="ltr" class="gmail_attr">On Tue, Nov 3, 2026, 2:42 PM, Ana &lt;ana@x.com&gt; wrote:<br></div>')
    expect(out).toContain('<blockquote class="gmail_quote" type="cite"')
    expect(out).toContain('<p>Dinner?</p><blockquote><p>older</p></blockquote>')
    expect(out).not.toMatch(/sovo-/)
    expect(out.startsWith('<p>Sounds good</p><div><p>Kai</p></div>')).toBe(true)
  })

  it("writes Exmail's includetail box with the answered message's header", () => {
    const out = nativeQuote(draft, 'exmail', header)
    expect(out).toContain('<includetail>')
    expect(out).toContain('Original')
    expect(out).toContain('<div id="menu_sender"><b>From: </b>&nbsp;"Ana Lima"&lt;ana@x.com&gt;;</div>')
    expect(out).toContain('<b>Subject: </b>&nbsp;Dinner')
    expect(out).toContain('<p>Dinner?</p>')
    expect(out).not.toContain('gmail_quote')
    expect(out).not.toMatch(/sovo-/)
  })

  it('falls back to Gmail markup when Exmail has no header', () => {
    expect(nativeQuote(draft, 'exmail', null)).toContain('gmail_quote')
  })

  it('leaves forwards and quote-less mail alone apart from markers', () => {
    const fwd = '<p>fyi</p><div class="sovo-quote"><p>---------- Forwarded message ----------</p><p>body</p></div>'
    expect(nativeQuote(fwd, 'gmail')).toBe('<p>fyi</p><div><p>---------- Forwarded message ----------</p><p>body</p></div>')
    expect(nativeQuote('<p>hi</p>', 'gmail')).toBe('<p>hi</p>')
  })

  it('keeps text the user typed inside the quote box', () => {
    const typed = draft.replace('<blockquote style', '<p>inline note</p><blockquote style')
    const out = nativeQuote(typed, 'gmail')
    expect(out).toContain('<p>inline note</p><div class="gmail_quote')
  })
})
