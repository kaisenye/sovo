import { getDb } from '../store/db.js'
import { refreshListRows } from '../store/listRows.js'
import { IMPORTANT_SQL } from '../store/search.js'

/** Classifier categories that count as noise. */
export const NOISE_CATEGORIES = ['newsletter', 'marketing', 'notification'] as const

/** One sender's noise in a folder, for Auto-clean's review list. */
export interface CleanGroup {
  sender: string
  name: string | null
  /** The thread's category, or 'bulk' when only the list headers say so. */
  kind: string
  count: number
  unread: number
  /** Newest-message ids of the group's conversations: what Done moves. */
  ids: number[]
}

/**
 * Noise in a folder, one group per sender, biggest first: conversations the
 * classifier put in a noise category, or (unclassified) bulk mail. Never
 * Important (so never a VIP), starred, muted or reminded mail.
 */
export function cleanGroups(folderId: number): CleanGroup[] {
  refreshListRows()
  const cats = NOISE_CATEGORIES.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT lr.newest_id, lr.sender, lr.unread_count, COALESCE(lr.ai_category, 'bulk') AS kind, m.from_name
         FROM list_rows lr JOIN messages m ON m.id = lr.newest_id
        WHERE lr.folder_id = ? AND lr.hidden = 0 AND lr.flagged = 0 AND lr.sender IS NOT NULL
          AND (lr.ai_category IN (${cats}) OR (lr.ai_category IS NULL AND lr.bulk = 1))
          AND NOT ${IMPORTANT_SQL}
        ORDER BY lr.sort_date DESC`
    )
    .all(folderId, ...NOISE_CATEGORIES) as {
    newest_id: number
    sender: string
    unread_count: number
    kind: string
    from_name: string | null
  }[]
  const by = new Map<string, CleanGroup>()
  for (const r of rows) {
    let g = by.get(r.sender)
    if (!g) {
      g = { sender: r.sender, name: r.from_name, kind: r.kind, count: 0, unread: 0, ids: [] }
      by.set(r.sender, g)
    }
    g.count++
    if (r.unread_count > 0) g.unread++
    g.ids.push(r.newest_id)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.sender.localeCompare(b.sender))
}
