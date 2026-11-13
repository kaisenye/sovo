import type { MessageListRow } from '../core/store/types'

const hasSeen = (flags: string | null): boolean =>
  !!flags && (JSON.parse(flags) as string[]).some((f) => f.toLowerCase() === '\\seen')

const sameThread = (r: MessageListRow, threadId: string, accountId?: number): boolean =>
  r.thread_id === threadId && (accountId == null || r.account_id === accountId)

/**
 * Every row of the thread painted read: its newest message's flags and the
 * thread's unread count, which is what the list's dot reads. Returns the same
 * array when nothing changed, so the store does not re-render for nothing.
 */
export function markThreadRowsSeen(
  rows: MessageListRow[],
  threadId: string,
  accountId?: number
): MessageListRow[] {
  let changed = false
  const next = rows.map((r) => {
    if (!sameThread(r, threadId, accountId)) return r
    const seen = hasSeen(r.flags)
    if (seen && !r.thread_unread) return r
    changed = true
    return {
      ...r,
      flags: seen ? r.flags : JSON.stringify([...(r.flags ? (JSON.parse(r.flags) as string[]) : []), '\\Seen']),
      ...(r.thread_unread === undefined ? {} : { thread_unread: 0 })
    }
  })
  return changed ? next : rows
}

/**
 * Threads read on screen, so a list read already in flight when the thread
 * opened (a sync refresh, say) cannot land after and paint it unread again.
 * A read issued after the mark reaches SQLite after it too (IPC is in order),
 * so only reads issued earlier are patched; new mail on the thread later
 * still shows as unread.
 */
export class LocalReads {
  private seq = 0
  private marks = new Map<string, { seq: number; threadId: string; accountId?: number; at: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  mark(threadId: string, accountId?: number): void {
    const at = this.now()
    // A read in flight is answered in well under a minute.
    for (const [k, m] of this.marks) if (at - m.at > 60_000) this.marks.delete(k)
    this.marks.set(`${accountId ?? ''}:${threadId}`, { seq: ++this.seq, threadId, accountId, at })
  }

  /** Taken just before a list read is sent. */
  issued(): number {
    return this.seq
  }

  /** Rows from a read sent at `issued`, with threads read since then painted read. */
  apply(rows: MessageListRow[], issued: number): MessageListRow[] {
    let out = rows
    for (const m of this.marks.values()) if (m.seq > issued) out = markThreadRowsSeen(out, m.threadId, m.accountId)
    return out
  }
}
