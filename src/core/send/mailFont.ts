/**
 * Mail text is sans-serif 12px: compose and the signature editor show it
 * (`--font-mail` in tokens.css), and the mail carries it, so recipients see
 * what you wrote. Text with its own font (a quoted original, a pasted block)
 * keeps that font; this only sets the default.
 */
export const MAIL_FONT_STYLE = 'font-family:sans-serif;font-size:12px;line-height:1.4'

/** The outgoing HTML, wrapped once in the mail font. */
export function withMailFont(html: string): string {
  if (!html.trim() || html.startsWith(`<div style="${MAIL_FONT_STYLE}">`)) return html
  return `<div style="${MAIL_FONT_STYLE}">${html}</div>`
}
