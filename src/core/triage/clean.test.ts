import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveClassification } from '../store/ai.js'
import { closeDb, getDb, initDb } from '../store/db.js'
import { markDirtyByMessageId } from '../store/listRows.js'
import { upsertMessage } from '../store/repo.js'
import { cleanGroups } from './clean.js'

let uid = 0
const put = (from: string, opts: { bulk?: boolean; flags?: string[]; name?: string } = {}) => {
  const id = ++uid
  upsertMessage({
    account_id: 1, folder_id: 1, uid: id, message_id: `<${id}@t>`, thread_id: `t${id}`,
    in_reply_to: null, from_addr: from, from_name: opts.name ?? null, to_addrs: '[]', cc_addrs: '[]',
    subject: `s${id}`, date: 1_000 + id, snippet: null, flags: JSON.stringify(opts.flags ?? ['\\Seen']),
    bulk: opts.bulk ? 1 : 0
  })
  return id
}
const classify = (id: number, category: string, important = false) => {
  saveClassification(1, `<${id}@t>`, { important, category: category as never, reason: 'r', model: 'm' })
  markDirtyByMessageId(1, `<${id}@t>`)
}

beforeEach(() => {
  closeDb()
  initDb(join(mkdtempSync(join(tmpdir(), 'clean-')), 't.db'))
  uid = 0
  getDb().prepare("INSERT INTO accounts (id,email) VALUES (1,'me@x.test')").run()
  getDb().prepare("INSERT INTO folders (id,account_id,path,role) VALUES (1,1,'INBOX','inbox')").run()
})

describe('cleanGroups', () => {
  it('groups noise by sender, biggest first, with unread counts', () => {
    const a = put('news@brew.test', { name: 'Morning Brew' })
    const b = put('news@brew.test', { flags: [] })
    const c = put('deals@shop.test')
    classify(a, 'newsletter')
    classify(b, 'newsletter')
    classify(c, 'marketing')
    expect(cleanGroups(1)).toEqual([
      { sender: 'news@brew.test', name: null, kind: 'newsletter', count: 2, unread: 1, ids: [b, a] },
      { sender: 'deals@shop.test', name: null, kind: 'marketing', count: 1, unread: 0, ids: [c] }
    ])
  })

  it('counts unclassified bulk mail, and never people, Important, starred or VIP mail', () => {
    const bulk = put('alerts@bank.test', { bulk: true })
    put('ana@friend.test')
    const work = put('boss@work.test')
    classify(work, 'work')
    const loud = put('promo@shop.test')
    classify(loud, 'marketing', true)
    put('promo@star.test', { bulk: true, flags: ['\\Seen', '\\Flagged'] })
    put('vip@list.test', { bulk: true })
    getDb().prepare("INSERT INTO vip_senders (account_id,address) VALUES (1,'vip@list.test')").run()
    // A bulk thread the classifier calls work is not noise either.
    const updates = put('team@saas.test', { bulk: true })
    classify(updates, 'work')
    expect(cleanGroups(1).map((g) => [g.sender, g.kind, g.ids])).toEqual([['alerts@bank.test', 'bulk', [bulk]]])
  })
})
