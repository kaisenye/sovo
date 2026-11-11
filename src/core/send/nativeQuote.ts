import { JSDOM } from 'jsdom'
import { stripComposeMarkers } from './mime.js'

/**
 * The wire form of a reply's quoted history, in the markup the sending
 * inbox's own web client writes, so it folds the reply's history the way it
 * folds its own:
 *
 *   - gmail:  Gmail's gmail_quote container (Gmail shows "•••"; Apple Mail,
 *             Outlook and most others recognise it or the cite blockquote)
 *   - exmail: Exmail's <includetail> block with its grey "Original" header
 *
 * Compose keeps its own `sovo-quote` div (attribution <p> + <blockquote>);
 * this only rewrites the copy that goes out. Forwards are left as they are.
 */

export type QuoteStyle = 'gmail' | 'exmail'

/** The message being answered, for Exmail's From / Date / To / Subject box. */
export interface QuotedHeader {
  from_addr: string | null
  from_name: string | null
  to_addrs: string | null
  date: number | null
  subject: string | null
}

/** Exmail (Tencent / QQ) hosts write Exmail's markup; everyone else Gmail's. */
export function quoteStyleFor(imapHost: string): QuoteStyle {
  return /(^|\.)(exmail\.)?qq\.com$/i.test(imapHost.trim()) ? 'exmail' : 'gmail'
}

const GMAIL_BLOCKQUOTE_STYLE = 'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function exmailDate(epoch: number): string {
  return new Date(epoch).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function gmailQuote(attribution: string, inner: string): string {
  return (
    '<div class="gmail_quote gmail_quote_container">' +
    `<div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>` +
    `<blockquote class="gmail_quote" type="cite" style="${GMAIL_BLOCKQUOTE_STYLE}">${inner}</blockquote>` +
    '</div>'
  )
}

function exmailQuote(h: QuotedHeader, inner: string): string {
  const from = h.from_name?.trim()
    ? `"${escapeHtml(h.from_name.trim())}"&lt;${escapeHtml(h.from_addr ?? '')}&gt;;`
    : `${escapeHtml(h.from_addr ?? '')};`
  const rows = [`<div id="menu_sender"><b>From: </b>&nbsp;${from}</div>`]
  if (h.date) rows.push(`<div><b>Date: </b>&nbsp;${escapeHtml(exmailDate(h.date))}</div>`)
  if (h.to_addrs?.trim()) rows.push(`<div><b>To: </b>&nbsp;${escapeHtml(h.to_addrs.trim())}</div>`)
  if (h.subject?.trim()) rows.push(`<div><b>Subject: </b>&nbsp;${escapeHtml(h.subject.trim())}</div>`)
  return (
    '<div><includetail><div>&nbsp;</div>' +
    '<div style="font:Verdana normal 14px;color:#000;">' +
    '<div style="FONT-SIZE: 12px;FONT-FAMILY: Arial Narrow;padding:2px 0 2px 0;">------------------&nbsp;Original&nbsp;------------------</div>' +
    `<div style="FONT-SIZE: 12px;background:#efefef;padding:8px;">${rows.join('')}</div>` +
    `<div>&nbsp;</div>${inner}</div></includetail></div>`
  )
}

/**
 * Rewrites the compose quote of a reply into `style`'s native markup and drops
 * every compose marker. Exmail's box needs the answered message's header; with
 * none it falls back to Gmail's markup.
 */
export function nativeQuote(html: string, style: QuoteStyle, header: QuotedHeader | null = null): string {
  if (!/<div class="(?:sovo|supermail)-quote"/.test(html)) return stripComposeMarkers(html)
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document
  for (const box of doc.querySelectorAll('div.sovo-quote, div.supermail-quote')) {
    const quote = [...box.children].find((c) => c.tagName === 'BLOCKQUOTE')
    // A forward keeps its own header block and no blockquote: leave it.
    if (!quote) continue
    const attr = [...box.children].find((c) => c.tagName === 'P' && c !== quote)
    const attribution = (attr?.textContent ?? '').replace(/\s+/g, ' ').trim()
    // Anything typed into the quote box besides those two stays, above the quote.
    const extra = [...box.childNodes]
      .filter((n) => n !== quote && n !== attr)
      .map((n) => (n.nodeType === 1 ? (n as Element).outerHTML : (n.textContent ?? '')))
      .join('')
      .trim()
    const native =
      style === 'exmail' && header
        ? exmailQuote(header, quote.innerHTML)
        : gmailQuote(attribution, quote.innerHTML)
    const tpl = doc.createElement('template')
    tpl.innerHTML = extra + native
    box.replaceWith(tpl.content)
  }
  return stripComposeMarkers(doc.body.innerHTML)
}
