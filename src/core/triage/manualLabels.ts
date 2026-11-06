import { AI_CATEGORIES } from '../ai/classify.js'
import { getDb } from '../store/db.js'
import { markDirtyByMessageId, refreshListRows } from '../store/listRows.js'
import { IMPORTANT_SQL } from '../store/search.js'

/**
 * L on any inbox: Important, the default categories and the inbox's own
 * labels, set by hand. A pick is stored as a manual verdict (v24
 * ai_classifications.manual) on every message of the thread, so the
 * classifier and the labels job leave the thread alone from then on.
 */

/** Picker ids, kept apart from Gmail label names. */
export const IMPORTANT_ID = 'sovo:important'
const CATEGORY_PREFIX = 'sovo:cat:'
const OWN_PREFIX = 'sovo:own:'

export const isLocalLabelId = (id: string): boolean => id.startsWith('sovo:')

export interface LocalLabelChoice {
  id: string
  label: string
  checked: boolean
}

interface RowState {
  accountId: number
  /** Every message of the thread, in every folder, that has a Message-ID. */
  mates: { id: number; message_id: string }[]
  important: boolean
  category: string
  /** Own label names on any message of the thread, lower-cased. */
  own: Set<string>
}

const title = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1)

function rowStates(ids: number[]): RowState[] {
  refreshListRows()
  const db = getDb()
  const msg = db.prepare('SELECT id, account_id, folder_id, thread_id FROM messages WHERE id = ?')
  const row = db.prepare(
    `SELECT ${IMPORTANT_SQL} AS important, lr.ai_category AS category
       FROM list_rows lr WHERE lr.account_id = ? AND lr.folder_id = ? AND lr.thread_key = ?`
  )
  const thread = db.prepare(
    'SELECT id, message_id FROM messages WHERE account_id = ? AND thread_id = ? AND message_id IS NOT NULL'
  )
  const own = db.prepare(
    `SELECT DISTINCT lower(l.name) AS name FROM ai_message_labels x
       JOIN ai_labels l ON l.id = x.label_id
      WHERE x.account_id = ? AND x.message_id = ?`
  )
  const seen = new Set<string>()
  const out: RowState[] = []
  for (const id of ids) {
    const m = msg.get(id) as { id: number; account_id: number; folder_id: number | null; thread_id: string | null } | undefined
    if (!m || m.folder_id === null) continue
    const key = m.thread_id ?? `#${m.id}`
    // A selection can hold two rows of one thread (search): label it once.
    if (seen.has(`${m.account_id}\n${key}`)) continue
    seen.add(`${m.account_id}\n${key}`)
    const mates = m.thread_id
      ? (thread.all(m.account_id, m.thread_id) as { id: number; message_id: string }[])
      : (db.prepare('SELECT id, message_id FROM messages WHERE id = ? AND message_id IS NOT NULL').all(m.id) as {
          id: number
          message_id: string
        }[])
    if (!mates.length) continue
    const r = row.get(m.account_id, m.folder_id, key) as { important: number; category: string | null } | undefined
    const names = new Set<string>()
    for (const x of mates) for (const n of own.all(m.account_id, x.message_id) as { name: string }[]) names.add(n.name)
    out.push({
      accountId: m.account_id,
      mates,
      important: !!r?.important,
      category: r?.category ?? 'other',
      own: names
    })
  }
  return out
}

/** Own labels every owning inbox has, by name (ignoring case), in the first inbox's order. */
function sharedOwnLabels(accountIds: number[]): string[] {
  const list = getDb().prepare('SELECT name FROM ai_labels WHERE account_id = ? ORDER BY created_at, id')
  const [first, ...rest] = [...new Set(accountIds)].map((a) => (list.all(a) as { name: string }[]).map((r) => r.name))
  if (!first) return []
  return first.filter((n) => rest.every((names) => names.some((x) => x.toLowerCase() === n.toLowerCase())))
}

/** The picker's local half: checked where every target thread already carries the label. */
export function localLabelChoices(ids: number[]): LocalLabelChoice[] {
  const rows = rowStates(ids)
  if (!rows.length) return []
  const every = (f: (r: RowState) => boolean): boolean => rows.every(f)
  return [
    { id: IMPORTANT_ID, label: 'Important', checked: every((r) => r.important) },
    ...AI_CATEGORIES.filter((c) => c !== 'other').map((c) => ({
      id: CATEGORY_PREFIX + c,
      label: title(c),
      checked: every((r) => r.category === c)
    })),
    ...sharedOwnLabels(rows.map((r) => r.accountId)).map((n) => ({
      id: OWN_PREFIX + n,
      label: n,
      checked: every((r) => r.own.has(n.toLowerCase()))
    }))
  ]
}

/**
 * Adds or removes one label on every target thread. A thread has one
 * category, so adding one replaces the last; removing it leaves Other.
 * Returns how many threads were written.
 */
export function setLocalLabel(ids: number[], id: string, add: boolean, now = Date.now()): number {
  const rows = rowStates(ids)
  const db = getDb()
  const verdict = db.prepare(
    `INSERT INTO ai_classifications (account_id, message_id, important, category, reason, model, created_at, manual)
     VALUES (?, ?, ?, ?, 'Labelled by you', 'manual', ?, 1)
     ON CONFLICT (account_id, message_id) DO UPDATE SET
       important = excluded.important, category = excluded.category, reason = excluded.reason,
       model = excluded.model, created_at = excluded.created_at, manual = 1`
  )
  const dropOwn = db.prepare('DELETE FROM ai_message_labels WHERE account_id = ? AND message_id = ?')
  const addOwn = db.prepare(
    `INSERT OR IGNORE INTO ai_message_labels (account_id, message_id, label_id)
     SELECT ?, ?, id FROM ai_labels WHERE account_id = ? AND lower(name) = ?`
  )
  let written = 0
  db.transaction(() => {
    for (const r of rows) {
      let { important, category } = r
      const own = new Set(r.own)
      if (id === IMPORTANT_ID) important = add
      else if (id.startsWith(CATEGORY_PREFIX)) {
        const c = id.slice(CATEGORY_PREFIX.length)
        if (!(AI_CATEGORIES as readonly string[]).includes(c)) continue
        if (add) category = c
        else if (category === c) category = 'other'
      } else if (id.startsWith(OWN_PREFIX)) {
        const n = id.slice(OWN_PREFIX.length).toLowerCase()
        if (add) own.add(n)
        else own.delete(n)
      } else continue
      for (const m of r.mates) {
        verdict.run(r.accountId, m.message_id, important ? 1 : 0, category, now)
        dropOwn.run(r.accountId, m.message_id)
        for (const n of own) addOwn.run(r.accountId, m.message_id, r.accountId, n)
        markDirtyByMessageId(r.accountId, m.message_id)
      }
      written++
    }
  })()
  return written
}
