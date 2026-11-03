import { getDb } from '../store/db.js'
import type { Message } from '../store/types.js'
import { asData, messageText, who } from './mailText.js'

type Row = Pick<Message, 'id' | 'thread_id' | 'from_addr' | 'from_name' | 'subject' | 'date' | 'body_text' | 'body_html' | 'snippet'>

const COLS = 'id, thread_id, from_addr, from_name, subject, date, body_text, body_html, snippet'
const attr = (s: string): string => s.replace(/"/g, '')

/**
 * Earlier conversations with one person, for replies that know your history:
 * the newest `threads` other conversations they wrote in or you wrote to them
 * in, two messages each, newest first. Mailing-list mail is left out. Empty
 * when there are none (or the address is the account's own).
 */
export function pastThreads(
  accountId: number,
  address: string | null | undefined,
  excludeThreadKey: string,
  opts: { threads?: number; perThread?: number; charsPerMessage?: number } = {}
): string {
  const addr = (address ?? '').trim().toLowerCase()
  if (!addr) return ''
  const db = getDb()
  const me = (db.prepare('SELECT lower(email) AS e FROM accounts WHERE id = ?').get(accountId) as { e: string } | undefined)?.e
  if (!me || addr === me) return ''
  const threads = opts.threads ?? 3
  const perThread = opts.perThread ?? 2
  const base = `account_id = ? AND folder_id IS NOT NULL AND bulk = 0 AND COALESCE(thread_id, '#' || id) <> ?`
  // Two indexed reads (idx_messages_from) rather than one OR, which would scan the account.
  const theirs = db
    .prepare(`SELECT ${COLS} FROM messages WHERE ${base} AND lower(from_addr) = ? ORDER BY date DESC LIMIT 40`)
    .all(accountId, excludeThreadKey, addr) as Row[]
  const mine = db
    .prepare(
      `SELECT ${COLS} FROM messages
        WHERE ${base} AND lower(from_addr) = ? AND instr(lower(to_addrs) || lower(cc_addrs), ?) > 0
        ORDER BY date DESC LIMIT 40`
    )
    .all(accountId, excludeThreadKey, me, JSON.stringify(addr)) as Row[]
  const byThread = new Map<string, Row[]>()
  const seen = new Set<number>()
  for (const r of [...theirs, ...mine].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const key = r.thread_id ?? `#${r.id}`
    const list = byThread.get(key)
    if (list) {
      if (list.length < perThread) list.push(r)
    } else if (byThread.size < threads) byThread.set(key, [r])
  }
  return [...byThread.values()]
    .map((msgs) => {
      const blocks = msgs
        .slice()
        .reverse()
        .map((m) => {
          const date = m.date ? new Date(m.date).toISOString().slice(0, 10) : 'unknown'
          return `<message from="${attr(who(m))}" date="${date}">\n${asData(messageText(m, opts.charsPerMessage ?? 600))}\n</message>`
        })
      return `Earlier conversation: ${attr(msgs[0].subject ?? '(no subject)')}\n${blocks.join('\n')}`
    })
    .join('\n\n')
}

/** The prompt section that carries pastThreads(); empty when there is no history. */
export function historySection(history: string | undefined): string {
  return history?.trim()
    ? `Earlier conversations with this person, newest first. Use them only for context (facts, what was agreed, how the user usually writes to them); answer the latest message:\n${history.trim()}`
    : ''
}
