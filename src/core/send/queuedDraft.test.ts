import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDb, getDb, initDb } from '../store/db.js'
import { countDrafts, createDraft, listDrafts } from '../store/repo.js'
import { cancelOutbox, cancelQueuedForDraft, enqueueOutbox, getOutbox } from './outbox.js'

beforeEach(() => {
  closeDb()
  initDb(join(mkdtempSync(join(tmpdir(), 'queued-draft-')), 't.db'))
  getDb().prepare("INSERT INTO accounts (id,email) VALUES (1,'a@x.test')").run()
})

const draft = (subject: string): number =>
  createDraft({ account_id: 1, from_addr: 'a@x.test', to_addrs: 'r@x.test', subject, body_text: 'hi' })
const schedule = (draftId: number, send_at = Date.now() + 3_600_000): number =>
  enqueueOutbox({ account_id: 1, draft_message_id: draftId, to_addrs: 'r@x.test', subject: 's', send_at }).id
const drafts = (): string[] => listDrafts(1, null).map((r) => r.subject ?? '')

describe('a draft queued to send', () => {
  it('leaves Drafts while scheduled and comes back when cancelled', () => {
    const kept = draft('still a draft')
    const sched = draft('scheduled')
    const id = schedule(sched)
    expect(drafts()).toEqual(['still a draft'])
    expect(countDrafts(1, null)).toBe(1)
    cancelOutbox(id)
    expect(drafts().sort()).toEqual(['scheduled', 'still a draft'])
    expect(countDrafts(1, null)).toBe(2)
    expect(kept).toBeGreaterThan(0)
  })

  it('replaces its earlier pending send when sent again', () => {
    const d = draft('x')
    const first = schedule(d)
    expect(cancelQueuedForDraft(d)).toEqual([first])
    expect(getOutbox(first)?.status).toBe('cancelled')
    expect(cancelQueuedForDraft(d)).toEqual([])
  })
})
