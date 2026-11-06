import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDb, getDb, initDb } from '../store/db.js'
import { getThread, ownSentId, upsertMessage } from '../store/repo.js'
import { hasSentCopy } from './sentRefresh.js'
import { listView } from '../store/listRows.js'
import { addLocalSentCopy, addressJson, outboxMessageId } from './localSent.js'
import { cancelOutbox, enqueueOutbox, markOutboxFailed } from './outbox.js'

const ME = { email: 'me@x.test', name: 'Kai' }
const sentRows = () =>
  getDb().prepare('SELECT id, uid, message_id, thread_id, subject FROM messages WHERE folder_id = 2 ORDER BY id').all() as {
    id: number
    uid: number | null
    message_id: string
    thread_id: string
    subject: string
  }[]

beforeEach(() => {
  closeDb()
  initDb(join(mkdtempSync(join(tmpdir(), 'localsent-')), 't.db'))
  getDb().prepare("INSERT INTO accounts (id,email) VALUES (1,'me@x.test')").run()
  getDb().prepare("INSERT INTO folders (id,account_id,path,role) VALUES (1,1,'INBOX','inbox'),(2,1,'Sent Messages','sent')").run()
})

const queue = (o: Partial<Parameters<typeof enqueueOutbox>[0]> = {}) =>
  enqueueOutbox({
    account_id: 1,
    draft_message_id: null,
    to_addrs: '"Doe, Jane" <jane@y.test>, bob@y.test',
    subject: 'Re: Friday',
    body_text: 'Yes, Friday works.',
    body_html: '<p>Yes, Friday works.</p>',
    send_at: Date.now(),
    ...o
  })

describe('the local Sent copy', () => {
  it('shows in Sent at once, read, with the Message-ID the send will carry', () => {
    const row = queue()
    const id = addLocalSentCopy(row, ME)
    expect(id).not.toBeNull()
    expect(sentRows()).toEqual([
      expect.objectContaining({ id, uid: null, message_id: outboxMessageId(row), subject: 'Re: Friday' })
    ])
    expect(listView(2).map((r) => r.id)).toEqual([id])
    // Idempotent: the flush adding it again keeps one.
    expect(addLocalSentCopy(row, ME)).toBe(id)
    expect(sentRows()).toHaveLength(1)
  })

  it('joins the conversation it answers, so the thread shows it', () => {
    upsertMessage({
      account_id: 1, folder_id: 1, uid: 7, message_id: '<root@y.test>', thread_id: '<root@y.test>', in_reply_to: null,
      from_addr: 'jane@y.test', from_name: 'Jane', to_addrs: '[]', cc_addrs: '[]', subject: 'Friday', date: 1000,
      snippet: 'Friday?', flags: '[]'
    })
    const row = queue({ in_reply_to: '<root@y.test>', references_header: '<root@y.test>' })
    addLocalSentCopy(row, ME)
    expect(getThread(1, '<root@y.test>').map((m) => m.subject)).toEqual(['Re: Friday', 'Friday'])
  })

  it('becomes the server copy when sync finds it, with no duplicate', () => {
    const row = queue()
    const local = addLocalSentCopy(row, ME)
    const synced = upsertMessage({
      account_id: 1, folder_id: 2, uid: 4209, message_id: outboxMessageId(row), thread_id: outboxMessageId(row),
      in_reply_to: null, from_addr: 'me@x.test', from_name: 'Kai', to_addrs: '[]', cc_addrs: '[]',
      subject: 'Re: Friday', date: Date.now(), snippet: null, flags: '["\\\\Seen"]'
    })
    expect(synced).toBe(local)
    expect(sentRows()).toEqual([expect.objectContaining({ id: local, uid: 4209 })])
  })

  it('is adopted by the server copy Exmail files under a rewritten Message-ID', () => {
    const row = queue()
    const local = addLocalSentCopy(row, ME)
    const exmailId = '<D975543DE3B09C09+' + outboxMessageId(row).slice(1)
    expect(hasSentCopy(1, 2, outboxMessageId(row))).toBe(false)
    const synced = upsertMessage({
      account_id: 1, folder_id: 2, uid: 4209, message_id: exmailId, thread_id: exmailId,
      in_reply_to: null, from_addr: 'me@x.test', from_name: 'Kai', to_addrs: '[]', cc_addrs: '[]',
      subject: 'Re: Friday', date: Date.now(), snippet: null, flags: '["\\\\Seen"]'
    })
    expect(synced).toBe(local)
    expect(sentRows()).toEqual([expect.objectContaining({ id: local, uid: 4209, message_id: exmailId })])
    expect(hasSentCopy(1, 2, outboxMessageId(row))).toBe(true)
    // Another account's or another send's id is not taken for ours.
    expect(ownSentId('<abc+other@x.test>')).toBeNull()
  })

  it('leaves when the send is undone or fails, and only its own copy', () => {
    const undone = queue({ subject: 'undone' })
    const failed = queue({ subject: 'failed' })
    const kept = queue({ subject: 'kept' })
    for (const r of [undone, failed, kept]) addLocalSentCopy(r, ME)
    expect(cancelOutbox(undone.id)).toBe(true)
    markOutboxFailed(failed.id, 'SMTP 550')
    expect(sentRows().map((r) => r.subject)).toEqual(['kept'])
  })

  it('is skipped for an account with no Sent folder yet', () => {
    getDb().prepare('DELETE FROM folders WHERE id = 2').run()
    expect(addLocalSentCopy(queue(), ME)).toBeNull()
  })

  it('parses recipients, quoted commas included', () => {
    expect(JSON.parse(addressJson('"Doe, Jane" <jane@y.test>, bob@y.test'))).toEqual([
      { address: 'jane@y.test', name: 'Doe, Jane' },
      { address: 'bob@y.test', name: null }
    ])
    expect(addressJson(null)).toBe('[]')
  })
})
