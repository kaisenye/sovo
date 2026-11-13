import { describe, expect, it } from 'vitest'
import type { MessageListRow } from '../core/store/types'
import { LocalReads, markThreadRowsSeen } from './localRead'
import { useStore } from './store'

const row = (id: number, threadId: string, over: Partial<MessageListRow> = {}): MessageListRow =>
  ({ id, account_id: 1, thread_id: threadId, flags: '[]', thread_unread: 2, ...over }) as MessageListRow

const unread = (r: MessageListRow): boolean =>
  r.thread_unread === undefined ? !(r.flags ?? '').toLowerCase().includes('\\\\seen') : r.thread_unread > 0

describe('markThreadRowsSeen', () => {
  it('clears the thread unread count the dot reads, not only the newest message flag', () => {
    // The newest message is already read; an older one is not.
    const rows = [row(1, 't1', { flags: '["\\\\Seen"]', thread_unread: 1 }), row(2, 't2')]
    const out = markThreadRowsSeen(rows, 't1', 1)
    expect(unread(out[0])).toBe(false)
    expect(out[0].thread_unread).toBe(0)
    expect(out[1]).toBe(rows[1])
  })

  it('adds \\Seen to the row flags, and leaves an unthreaded row without a count', () => {
    const out = markThreadRowsSeen([row(1, 't1', { thread_unread: undefined })], 't1')
    expect(JSON.parse(out[0].flags!)).toEqual(['\\Seen'])
    expect(out[0].thread_unread).toBeUndefined()
  })

  it('matches the account: thread ids collide across accounts', () => {
    const rows = [row(1, 't1'), row(2, 't1', { account_id: 2 })]
    const out = markThreadRowsSeen(rows, 't1', 2)
    expect(unread(out[0])).toBe(true)
    expect(unread(out[1])).toBe(false)
  })

  it('returns the same array when nothing changes', () => {
    const rows = [row(1, 't1', { flags: '["\\\\Seen"]', thread_unread: 0 })]
    expect(markThreadRowsSeen(rows, 't1', 1)).toBe(rows)
  })
})

describe('LocalReads', () => {
  it('keeps a thread read when a list read sent before it was opened lands after', () => {
    const reads = new LocalReads(() => 0)
    const issued = reads.issued()
    reads.mark('t1', 1)
    const stale = [row(1, 't1'), row(2, 't2')]
    const out = reads.apply(stale, issued)
    expect(unread(out[0])).toBe(false)
    expect(unread(out[1])).toBe(true)
  })

  it('trusts a list read sent after the open, so new mail on the thread shows unread', () => {
    const reads = new LocalReads(() => 0)
    reads.mark('t1', 1)
    const issued = reads.issued()
    const fresh = [row(1, 't1', { thread_unread: 1 })]
    expect(reads.apply(fresh, issued)).toBe(fresh)
  })

  it('forgets marks after a minute', () => {
    let t = 0
    const reads = new LocalReads(() => t)
    reads.mark('t1', 1)
    t = 61_000
    reads.mark('t2', 1)
    const out = reads.apply([row(1, 't1'), row(2, 't2')], 0)
    expect(unread(out[0])).toBe(true)
    expect(unread(out[1])).toBe(false)
  })
})

describe('store.markThreadSeen', () => {
  it('paints the list and the search cache read', () => {
    useStore.setState({
      rows: [row(1, 't1')],
      searchCache: { emails: [row(1, 't1')] } as never
    })
    useStore.getState().markThreadSeen('t1', 1)
    const st = useStore.getState()
    expect(unread(st.rows[0])).toBe(false)
    expect(unread(st.searchCache!.emails[0])).toBe(false)
  })
})
