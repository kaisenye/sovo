/** Gmail-style quoted reply body. Output is compose HTML, not sanitised mail. */

import { cleanPastedHtml } from './richText'

const ZERO = /^-?0(\.0+)?([a-z]+|%)?$/i

const BLOCKS = new Set(['BODY', 'BLOCKQUOTE', 'DIV', 'LI', 'P', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const isBlockTag = (el: Element): boolean => BLOCKS.has(el.tagName)

/**
 * Margin rules from the mail's own <style> for `p` and for classes (Outlook's
 * `p.MsoNormal { margin:0in }`): true where both vertical margins are zero.
 */
function sheetMargins(doc: Document): { p: boolean | null; cls: Map<string, boolean> } {
  const out = { p: null as boolean | null, cls: new Map<string, boolean>() }
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = m[2].toLowerCase()
    const all = /(?:^|;)\s*margin\s*:\s*([^;]+)/.exec(decl)?.[1].trim().split(/\s+/)
    const top = /margin-top\s*:\s*([^;!]+)/.exec(decl)?.[1].trim() ?? (all ? all[0] : undefined)
    const bottom = /margin-bottom\s*:\s*([^;!]+)/.exec(decl)?.[1].trim() ?? (all ? (all[2] ?? all[0]) : undefined)
    if (top === undefined && bottom === undefined) continue
    const zero = ZERO.test(top ?? '0') && ZERO.test(bottom ?? '0')
    for (const sel of m[1].split(',').map((s) => s.trim().toLowerCase())) {
      if (sel === 'p') out.p = zero
      const c = /^p?\.([\w-]+)$/.exec(sel)
      if (c) out.cls.set(c[1], zero)
    }
  }
  return out
}

/**
 * The original's HTML, made fit to quote. The compose editor keeps no styles
 * and turns every newline into a <br> (that is how a typed line break looks),
 * so a mail quoted raw came out with a blank line per source line and a 1em
 * gap under every paragraph its sender had set to margin 0. Here newlines in
 * text become the spaces they render as, and a <p> with no vertical margin
 * (inline, a class rule, or the mail's p rule) becomes a <div>, which keeps
 * its spacing once styles go. Then the usual compose cleaning, so nothing
 * remote loads in the editor.
 */
export function quotableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const sheet = sheetMargins(doc)
  for (const p of [...doc.body.querySelectorAll('p')]) {
    const style = (p as HTMLElement).style
    const cls = [...p.classList].map((c) => sheet.cls.get(c.toLowerCase())).find((v) => v !== undefined)
    const fallback = cls ?? sheet.p ?? false
    const top = style.marginTop ? ZERO.test(style.marginTop) : fallback
    const bottom = style.marginBottom ? ZERO.test(style.marginBottom) : fallback
    if (!top || !bottom) continue
    const div = doc.createElement('div')
    div.append(...p.childNodes)
    p.replaceWith(div)
  }
  // Whitespace as a browser renders it: runs collapse to one space, and none
  // at the edge of a block (the editor is pre-wrap, so it would show).
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement
    if (!n.nodeValue || parent?.closest('pre')) continue
    let v = n.nodeValue.replace(/[ \t\r\n]+/g, ' ')
    const blockParent = parent && isBlockTag(parent)
    if (blockParent && !n.previousSibling) v = v.replace(/^ /, '')
    if (blockParent && !n.nextSibling) v = v.replace(/ $/, '')
    n.nodeValue = v
  }
  return cleanPastedHtml(doc.body.innerHTML)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** "On Mon, Jan 5, 2026 at 9:04 AM, Ada <ada@x.com> wrote:" */
export function attributionLine(
  from: string | null,
  fromName: string | null,
  date: number | null
): string {
  const who = fromName?.trim() ? `${fromName.trim()} <${from ?? ''}>` : (from ?? 'someone')
  const d = date ? new Date(date) : null
  if (!d || Number.isNaN(d.getTime())) return `${who} wrote:`
  const when = d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `On ${when}, ${who} wrote:`
}

export interface QuoteSource {
  from_addr: string | null
  from_name: string | null
  date: number | null
  body_text: string | null
  body_html: string | null
  subject?: string | null
  to_addrs?: string | null
}

/**
 * Reply body: an empty paragraph to type into, then the quoted original
 * (`quotableHtml`, so it keeps its spacing and loads nothing remote).
 */
export function buildReplyBody(msg: QuoteSource): string {
  const inner = msg.body_html
    ? quotableHtml(msg.body_html)
    : escapeHtml(msg.body_text ?? '').replace(/\r?\n/g, '<br>')
  const attribution = escapeHtml(
    attributionLine(msg.from_addr, msg.from_name, msg.date)
  )
  return (
    '<div><br></div>' +
    `<div class="sovo-quote"><p>${attribution}</p>` +
    `<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex">${inner}</blockquote></div>`
  )
}

/**
 * Forward body. Unlike a reply this keeps the original headers, because the
 * new recipient has no other way to see who sent it or when.
 */
export function buildForwardBody(msg: QuoteSource): string {
  const inner = msg.body_html
    ? quotableHtml(msg.body_html)
    : escapeHtml(msg.body_text ?? '').replace(/\r?\n/g, '<br>')
  const from = msg.from_name
    ? `${msg.from_name} <${msg.from_addr ?? ''}>`
    : (msg.from_addr ?? '(unknown)')
  const rows: string[] = [`<b>From:</b> ${escapeHtml(from)}`]
  if (msg.date) rows.push(`<b>Date:</b> ${escapeHtml(new Date(msg.date).toLocaleString())}`)
  if (msg.subject) rows.push(`<b>Subject:</b> ${escapeHtml(msg.subject)}`)
  if (msg.to_addrs) rows.push(`<b>To:</b> ${escapeHtml(msg.to_addrs)}`)

  return (
    '<div><br></div>' +
    '<div class="sovo-quote"><p>---------- Forwarded message ----------</p>' +
    `<p>${rows.join('<br>')}</p>${inner}</div>`
  )
}

/**
 * The signature, marked so Write with AI can stop above it. The saved draft
 * keeps the class; main strips it on queueSend, so the mail carries no marker.
 */
export function signatureBlock(signature: string): string {
  // Cleaned again so indentation saved before the editor dropped it shows
  // no stray blank lines.
  return `<div class="sovo-signature">${cleanPastedHtml(signature, { keepColors: true })}</div>`
}
