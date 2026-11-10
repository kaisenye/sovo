import type { Ai } from '../services/ai/service.js'
import { localDay } from '../services/ai/service.js'
import { AiError, type AiRequest } from '../services/ai/types.js'
import { getDb } from '../store/db.js'
import { refreshListRows } from '../store/listRows.js'
import { asData, MAIL_IS_DATA, messageText, NO_EM_DASH, noEmDash, who } from './mailText.js'

const STOP = new Set(
  (
    'a about after again all also am an and any anything are as at be been before but by can could did do does email ' +
    'emails for from get got had has have he her him his how i if in into is it its last latest me message messages mail ' +
    'my no not of on or our recent said say send sent she should show so some tell than that the their them then there ' +
    'these this those to us was we were what when where which who whom why will with would you your ' +
    // Handled by planAsk as a time window or the to-do intent, not as search words.
    'today yesterday week weeks month months lately latest newest most recently last past days ' +
    'todo todos to-do tasks task action items item follow up need needs reply respond pending owe ' +
    'much many any anyone please ask asked tell told whats'
  ).split(' ')
)

const HAN = /\p{Script=Han}/u
/** Chinese function words that glue a question together; a Han run is cut at each one. */
const HAN_STOP = /多少|什么|怎么|怎样|如何|为什么|哪里|哪些|是否|有没有|最近|今天|昨天|本周|这周|上周|本月|待办|需要|回复|[的是吗呢了我你在哪说]/gu

/** The words of a question worth searching for, at most eight. */
export function askTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const out: string[] = []
  for (const word of words) {
    const parts = HAN.test(word) ? word.split(HAN_STOP) : [word]
    for (const w of parts) {
      // One character left over from a cut (们 of 我们) matches nearly all
      // Chinese mail; only a one-character question as typed is kept.
      const single = [...w].length < 2 && (!HAN.test(w) || parts.length > 1)
      if (!w || STOP.has(w) || single || out.includes(w)) continue
      out.push(w)
      if (out.length === 8) return out
    }
  }
  return out
}

const DAY = 86_400_000

export interface AskPlan {
  terms: string[]
  /** Only mail on or after this time (a "this week", "recent", 最近 question). */
  since: number | null
  /** A to-do question: what the user owes a reply on, newest first. */
  todo: boolean
  /** "latest", "most recent": recency outweighs the match. */
  recent: boolean
}

const TODO_RE =
  /\b(to-?dos?|tasks?|action items?|follow[- ]?ups?|need to (?:reply|respond|do|answer)|reply to|respond to|owe|pending|outstanding)\b|待办|要回复|需要回复|跟进/i

/** What a question asks for, read without the model: its words, a time window, and whether it wants to-dos. */
export function planAsk(question: string, now = Date.now()): AskPlan {
  const q = question.toLowerCase()
  let days: number | null = null
  const n = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(q)
  if (n) days = Number(n[1])
  else if (/\btoday\b|今天/.test(q)) days = 1
  else if (/\byesterday\b|昨天/.test(q)) days = 2
  else if (/\bthis week\b|本周|这周/.test(q)) days = 7
  else if (/\blast week\b|上周/.test(q)) days = 14
  else if (/\bthis month\b|本月/.test(q)) days = 31
  else if (/\blast month\b|上个月/.test(q)) days = 62
  const recent = /\b(recent(ly)?|latest|newest|lately|most recent|last)\b|最近|近期|最新/.test(q)
  const todo = TODO_RE.test(q)
  if (days === null && (todo || (recent && askTerms(question).length === 0))) days = 14
  return { terms: askTerms(question), since: days === null ? null : now - days * DAY, todo, recent }
}

export interface AskSource {
  /** The number the answer cites, [n]. */
  n: number
  id: number
  account_id: number
  thread_id: string | null
  subject: string | null
  from_name: string | null
  from_addr: string | null
  date: number | null
}

type Hit = Omit<AskSource, 'n'> & { body_text: string | null; body_html: string | null; snippet: string | null }

const HIT_COLS = `m.id, m.account_id, m.thread_id, m.subject, m.from_name, m.from_addr, m.date,
              m.body_text, m.body_html, m.snippet`

/** The 3-character windows of each Han term — what the trigram index can match inside a run. */
export function hanGrams(terms: string[]): string[] {
  const out = new Set<string>()
  for (const t of terms) {
    if (!HAN.test(t)) continue
    const cs = [...t]
    for (let i = 0; i + 3 <= cs.length; i++) out.add(cs.slice(i, i + 3).join(''))
  }
  return [...out]
}

/** Han terms too short for a trigram window, like 发票; these fall back to a substring scan. */
export function shortHan(terms: string[]): string[] {
  return terms.filter((t) => HAN.test(t) && [...t].length < 3)
}

/** Newest first, from recent Inbox conversations: the to-do path and a question that is only a time window. */
function recentInbox(accountIds: number[], plan: AskPlan, limit: number): Hit[] {
  refreshListRows()
  const inAccounts = `lr.account_id IN (${accountIds.map(() => '?').join(',')})`
  return getDb()
    .prepare(
      `SELECT ${HIT_COLS}
         FROM list_rows lr
         JOIN folders f ON f.id = lr.folder_id
         JOIN messages m ON m.id = lr.newest_id
        WHERE f.role = 'inbox' AND ${inAccounts} AND lr.hidden = 0 AND lr.bulk = 0
          AND lr.date >= ?
          ${plan.todo ? "AND lr.last_from_me = 0 AND COALESCE(lr.ai_category, '') NOT IN ('newsletter', 'marketing', 'notification')" : ''}
        ORDER BY lr.date DESC
        LIMIT ?`
    )
    .all(...accountIds, plan.since ?? 0, limit) as Hit[]
}

/** Keyword hits, best match first; ranked again below with their age. */
function keywordHits(accountIds: number[], plan: AskPlan, limit: number): Hit[] {
  const { terms } = plan
  if (!terms.length) return []
  const inAccounts = `m.account_id IN (${accountIds.map(() => '?').join(',')})`
  const since = plan.since === null ? '' : 'AND m.date >= ?'
  const window = plan.since === null ? [] : [plan.since]
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ${HIT_COLS}
         FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH ? AND m.folder_id IS NOT NULL AND ${inAccounts} ${since}
        ORDER BY bm25(messages_fts, 10.0, 6.0, 6.0, 1.0)
        LIMIT ?`
    )
    .all(terms.map((t) => `"${t}"*`).join(' OR '), ...accountIds, ...window, limit) as Hit[]
  const grams = hanGrams(terms)
  if (grams.length) {
    rows.push(
      ...(db
        .prepare(
          `SELECT ${HIT_COLS}
             FROM messages_trgm t JOIN messages m ON m.id = t.rowid
            WHERE messages_trgm MATCH ? AND m.folder_id IS NOT NULL AND ${inAccounts} ${since}
            ORDER BY rank
            LIMIT ?`
        )
        .all(grams.map((g) => `"${g.replace(/"/g, '')}"`).join(' OR '), ...accountIds, ...window, limit) as Hit[])
    )
  }
  const short = shortHan(terms)
  if (short.length) {
    // Terms are letters and digits only (askTerms), so no LIKE wildcard can sneak in.
    rows.push(
      ...(db
        .prepare(
          `SELECT ${HIT_COLS}
             FROM messages m
            WHERE (${short.map(() => '(m.subject LIKE ? OR m.body_text LIKE ?)').join(' OR ')})
              AND m.folder_id IS NOT NULL AND ${inAccounts} ${since}
            ORDER BY m.date DESC
            LIMIT ?`
        )
        .all(...short.flatMap((t) => [`%${t}%`, `%${t}%`]), ...accountIds, ...window, limit) as Hit[])
    )
  }
  return rows
}

/**
 * Keyword hits re-ranked by match and age together: the order the index gave
 * (best first) and how recent the mail is, so last week's GoDaddy order beats
 * last year's. A "latest" question leans on age harder.
 */
export function rankHits(rows: Hit[], plan: Pick<AskPlan, 'recent'>, now: number): Hit[] {
  const ageWeight = plan.recent ? 0.7 : 0.35
  const scored = rows.map((r, i) => {
    const match = 1 - i / Math.max(1, rows.length)
    const ageDays = Math.max(0, (now - (r.date ?? 0)) / DAY)
    const fresh = Math.exp(-ageDays / 90)
    return { r, score: match * (1 - ageWeight) + fresh * ageWeight }
  })
  return scored.sort((a, b) => b.score - a.score).map((x) => x.r)
}

/**
 * Local search over every given account, one hit per conversation. A to-do
 * question (or one that is only a time window, like "what came in today")
 * reads the recent Inbox; words go through the full-text index, the trigram
 * index for Han text, and a bounded substring scan for short Han terms, inside
 * the question's time window when it has one.
 */
export function retrieveForAsk(
  accountIds: number[],
  question: string,
  limit = 10,
  now = Date.now()
): (AskSource & { text: string })[] {
  if (!accountIds.length) return []
  const plan = planAsk(question, now)
  const recentFirst = plan.todo || (plan.since !== null && !plan.terms.length)
  if (!plan.terms.length && !recentFirst) return []
  const rows = [
    ...(recentFirst ? recentInbox(accountIds, plan, limit + 5) : []),
    ...rankHits(keywordHits(accountIds, plan, limit * 4), plan, now)
  ]
  const seen = new Set<string>()
  const out: (AskSource & { text: string })[] = []
  for (const r of rows) {
    const key = `${r.account_id}:${r.thread_id ?? `#${r.id}`}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      n: out.length + 1,
      id: r.id,
      account_id: r.account_id,
      thread_id: r.thread_id,
      subject: r.subject,
      from_name: r.from_name,
      from_addr: r.from_addr,
      date: r.date,
      text: messageText(r, 1500)
    })
    if (out.length >= limit) break
  }
  return out
}

const attr = (s: string): string => s.replace(/"/g, '')

/** "Fri, Nov 6", with the year when it is not this year: how people say a date. */
export function spokenDate(t: number, now: number): string {
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

export function askRequest(
  question: string,
  sources: (AskSource & { text: string })[],
  now: number,
  me: string[] = []
): AiRequest {
  const mine = new Set(me.map((e) => e.toLowerCase()))
  const blocks = sources.map((s) => {
    const date = s.date ? spokenDate(s.date, now) : 'unknown'
    const byMe = s.from_addr && mine.has(s.from_addr.toLowerCase()) ? ' by="the user"' : ''
    return `<message n="${s.n}" from="${attr(who(s))}"${byMe} date="${date}" subject="${attr(s.subject ?? '')}">\n${asData(s.text)}\n</message>`
  })
  return {
    system: [
      "You answer questions about the user's email, using only the numbered messages given.",
      'Answer directly, first line first. Keep it short: one or two sentences, or a few lines that each start with "- ".',
      'After each fact, cite the message it came from like [2]. Cite only messages you used.',
      'Write dates the way people say them, like Fri, Nov 6 (add the year only for another year). Never write 2026-11-06.',
      'Plain text only: no bold, no headings, no tables, no quotes around subjects.',
      'For to-dos, list what the user is asked to do or owes a reply on: what, who asked, and any deadline. Skip receipts, newsletters and notifications.',
      'If the messages do not answer the question, say so in one short sentence and cite nothing.',
      NO_EM_DASH,
      MAIL_IS_DATA
    ].join(' '),
    prompt: `Today is ${spokenDate(now, now)}, ${new Date(now).getFullYear()} (${localDay(now)}).\n\n${blocks.join('\n')}\n\nQuestion: ${question}`,
    maxTokens: 2000
  }
}

/**
 * The model's answer as the palette shows it: plain text, "- " bullets,
 * [n] citations. Markdown it slipped in (bold, headings, * bullets) and em
 * dashes come out.
 */
export function cleanAnswer(text: string): string {
  return noEmDash(
    text
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a, b) => a ?? b)
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[ \t]*[*•][ \t]+/gm, '- ')
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** The source numbers an answer cites, in the order it cites them. */
export function citedNumbers(answer: string): number[] {
  const out: number[] = []
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g))
    for (const n of m[1].split(',').map((x) => Number(x.trim()))) if (!out.includes(n)) out.push(n)
  return out
}

export async function askMail(
  ai: Ai,
  accountIds: number[],
  question: string,
  now = Date.now()
): Promise<{ answer: string; sources: AskSource[] }> {
  const q = question.trim()
  if (!q) throw new AiError('invalid', 'Ask a question')
  const found = retrieveForAsk(accountIds, q, 10, now)
  if (!found.length)
    return { answer: 'Nothing in your local mail matches that. Try a name, a company or a word from the subject.', sources: [] }
  const me = (
    getDb()
      .prepare(`SELECT email FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`)
      .all(...accountIds) as { email: string }[]
  ).map((a) => a.email)
  const r = await ai.run('ask', askRequest(q, found, now, me))
  const answer = cleanAnswer(r.text)
  // Only what the answer cites: an "it is not in your mail" answer lists nothing.
  const cited = citedNumbers(answer)
  return {
    answer,
    sources: cited
      .map((n) => found.find((x) => x.n === n))
      .filter((x): x is AskSource & { text: string } => !!x)
      .map((x) => {
        const { text: _drop, ...s } = x
        return s
      })
  }
}
