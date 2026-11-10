import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fakeAi } from '../services/ai/fake.js'
import { closeDb, getDb, initDb } from '../store/db.js'
import { upsertMessage } from '../store/repo.js'
import { askMail, askTerms, citedNumbers, cleanAnswer, hanGrams, planAsk, retrieveForAsk, shortHan, spokenDate } from './ask.js'

let uid = 0
function add(account: number, thread: string, subject: string, body: string, date: number, from = 'Acme <acme@billing.test>') {
  uid++
  const [, name, addr] = /^(.*) <(.*)>$/.exec(from)!
  upsertMessage({
    account_id: account,
    folder_id: account,
    uid,
    message_id: `<k${uid}@t>`,
    thread_id: thread,
    in_reply_to: null,
    from_addr: addr,
    from_name: name,
    to_addrs: '[]',
    cc_addrs: '[]',
    subject,
    date,
    snippet: body.slice(0, 40),
    body_text: body,
    body_fetched: 1,
    flags: '[]'
  })
}

beforeEach(() => {
  closeDb()
  initDb(join(mkdtempSync(join(tmpdir(), 'ask-')), 't.db'))
  uid = 0
  const db = getDb()
  db.prepare("INSERT INTO accounts (id,email) VALUES (1,'a@x.test'),(2,'b@x.test')").run()
  db.prepare("INSERT INTO folders (id,account_id,path,role) VALUES (1,1,'INBOX','inbox'),(2,2,'INBOX','inbox')").run()
  add(1, 'inv', 'Invoice 42', 'Your Acme invoice for October is $120, due Nov 5.', 1000)
  add(1, 'inv', 'Re: Invoice 42', 'Reminder: the Acme invoice is due soon.', 2000)
  add(2, 'trip', 'Flight to Lisbon', 'Your flight leaves at 9am.', 3000, 'Fly <tickets@fly.test>')
})

describe('Ask AI', () => {
  it('keeps the content words of a question', () => {
    expect(askTerms('When is the Acme invoice due?')).toEqual(['acme', 'invoice', 'due'])
    expect(askTerms('what did they say?')).toEqual(['they'])
  })

  it('finds one hit per conversation across accounts', () => {
    const hits = retrieveForAsk([1, 2], 'Acme invoice')
    expect(hits.map((h) => [h.n, h.account_id, h.thread_id])).toEqual([[1, 1, 'inv']])
    expect(retrieveForAsk([2], 'flight Lisbon').map((h) => h.subject)).toEqual(['Flight to Lisbon'])
    expect(retrieveForAsk([1], 'flight')).toEqual([])
  })

  it('answers from numbered sources and returns them without their text', async () => {
    const ai = fakeAi(() => 'It is due Nov 5 [1].')
    const r = await askMail(ai, [1, 2], 'When is the Acme invoice due?', new Date(2026, 9, 30).getTime())
    expect(r.answer).toBe('It is due Nov 5 [1].')
    expect(r.sources).toHaveLength(1)
    expect(r.sources[0]).not.toHaveProperty('text')
    expect(ai.calls[0].feature).toBe('ask')
    expect(ai.calls[0].req.prompt).toContain('Today is Fri, Oct 30, 2026')
    expect(ai.calls[0].req.prompt).toContain('<message n="1"')
    expect(ai.calls[0].req.prompt).toContain('Question: When is the Acme invoice due?')
  })

  it('finds Chinese mail for a Chinese question through the trigram index', async () => {
    add(2, 'fp', '十月账单', '请确认本月发票金额和付款时间，谢谢。', 4000, 'Tencent <bill@qq.test>')
    add(1, 'other', '会议纪要', '下周一上午十点开会。', 5000, 'Team <team@qq.test>')
    // unicode61 keeps the whole run as one token, so plain FTS cannot match inside it.
    // Function words cut the run, so the question words fall away.
    expect(askTerms('发票金额是多少？')).toEqual(['发票金额'])
    expect(hanGrams(['发票金额是多少', 'acme'])).toEqual(['发票金', '票金额', '金额是', '额是多', '是多少'])
    const hits = retrieveForAsk([1, 2], '发票金额是多少？')
    expect(hits.map((h) => [h.n, h.account_id, h.thread_id])).toEqual([[1, 2, 'fp']])
    expect(hits[0].text).toContain('发票金额')
    expect(retrieveForAsk([1], '发票金额是多少？')).toEqual([])
    const ai = fakeAi(() => '见 [1]。')
    const r = await askMail(ai, [1, 2], '发票金额是多少？')
    expect(r.sources.map((s) => s.thread_id)).toEqual(['fp'])
    expect(ai.calls).toHaveLength(1)
  })

  it('cuts Chinese function words out of a Han run', () => {
    expect(askTerms('上个月的发票')).toEqual(['上个月', '发票'])
    expect(askTerms('发票 付款')).toEqual(['发票', '付款'])
    expect(askTerms('付款时间是什么？')).toEqual(['付款时间'])
    expect(shortHan(['发票', '上个月', 'acme', '付款'])).toEqual(['发票', '付款'])
  })

  it('drops the single characters a cut leaves behind', async () => {
    expect(askTerms('我们的发票')).toEqual(['发票'])
    expect(askTerms('现在付款了吗')).toEqual(['付款'])
    expect(askTerms('你们在哪')).toEqual([])
    // A one-character question is still searched as typed.
    expect(askTerms('钱')).toEqual(['钱'])

    add(2, 'fp', '十月账单', '请确认本月发票金额', 1000, 'Tencent <bill@qq.test>')
    for (let i = 0; i < 50; i++) add(1, `n${i}`, '通知', `我们下周开会 ${i}`, 5000 + i, 'Team <team@qq.test>')
    expect(retrieveForAsk([1, 2], '我们的发票').map((h) => h.thread_id)).toEqual(['fp'])
  })

  it('finds Chinese mail for short keywords too short for a trigram window', async () => {
    add(2, 'fp', '十月账单', '请确认本月发票金额和付款时间', 4000, 'Tencent <bill@qq.test>')
    add(1, 'other', '会议纪要', '下周一上午十点开会。', 5000, 'Team <team@qq.test>')
    // "Last month" (上个月) is a window now: the test mail is a few seconds into 1970, so "now" sits just after it.
    const now = 10_000
    for (const q of ['发票', '发票 付款', '上个月的发票']) {
      const hits = retrieveForAsk([1, 2], q, 10, now)
      expect(hits.map((h) => [h.account_id, h.thread_id]), q).toEqual([[2, 'fp']])
      expect(retrieveForAsk([1], q, 10, now), q).toEqual([])
    }
    // Subject matches as well as body.
    expect(retrieveForAsk([1, 2], '账单').map((h) => h.thread_id)).toEqual(['fp'])
    const ai = fakeAi(() => '见 [1]。')
    const r = await askMail(ai, [1, 2], '上个月的发票', now)
    expect(r.sources.map((s) => s.thread_id)).toEqual(['fp'])
    expect(ai.calls).toHaveLength(1)
  })

  it('leaves drafts out of short-keyword hits', () => {
    add(1, 'd', '草稿', '发票草稿', 4000)
    getDb().prepare("UPDATE messages SET folder_id = NULL WHERE thread_id = 'd'").run()
    expect(retrieveForAsk([1], '发票')).toEqual([])
  })

  it('keeps one hit per conversation when FTS and trigram both match', () => {
    add(1, 'mix', 'Acme 发票金额', 'Acme 发票金额 is attached.', 4000)
    const hits = retrieveForAsk([1], 'Acme 发票金额')
    expect(hits.map((h) => h.thread_id).sort()).toEqual(['inv', 'mix'])
  })

  it('leaves drafts out of trigram hits', () => {
    add(1, 'd', '发票金额', '发票金额草稿', 4000)
    getDb().prepare("UPDATE messages SET folder_id = NULL WHERE thread_id = 'd'").run()
    expect(retrieveForAsk([1], '发票金额')).toEqual([])
  })

  it('says so without calling the model when nothing matches', async () => {
    const ai = fakeAi(() => 'x')
    const r = await askMail(ai, [1, 2], 'kangaroo', Date.now())
    expect(r.sources).toEqual([])
    expect(ai.calls).toHaveLength(0)
  })
})

describe('Ask AI, refined', () => {
  const DAY = 86_400_000
  const NOW = Date.UTC(2026, 10, 9, 18) // Mon, Nov 9 2026

  it('reads a time window and the to-do intent from the question', () => {
    expect(planAsk("what's recent todos", NOW)).toMatchObject({ todo: true, since: NOW - 14 * DAY, terms: [] })
    expect(planAsk('what do I need to reply to this week?', NOW)).toMatchObject({ todo: true, since: NOW - 7 * DAY })
    expect(planAsk('how much was my GoDaddy order?', NOW)).toMatchObject({ todo: false, since: null, terms: ['godaddy', 'order'] })
    expect(planAsk('latest from Jerry Fannin', NOW)).toMatchObject({ recent: true, since: null, terms: ['jerry', 'fannin'] })
    expect(planAsk('最近的待办', NOW)).toMatchObject({ todo: true, since: NOW - 14 * DAY })
  })

  it('answers a to-do question from recent mail you have not answered, not from a word match', () => {
    getDb().prepare("UPDATE accounts SET email = 'me@x.test' WHERE id = 1").run()
    add(1, 'old', 'todos list', 'my old todos', NOW - 400 * DAY, 'Bot <bot@x.test>')
    add(1, 'ask', 'Can you send the quote?', 'Please send the signed quote by Friday.', NOW - 2 * DAY, 'Jerry <jerry@g11.test>')
    add(1, 'done', 'Lunch?', 'Lunch Tuesday?', NOW - 3 * DAY, 'Ann <ann@x.test>')
    add(1, 'done', 'Re: Lunch?', 'Tuesday works.', NOW - 2.5 * DAY, 'Me <me@x.test>')
    const hits = retrieveForAsk([1], "what's recent todos", 10, NOW)
    expect(hits[0].thread_id).toBe('ask')
    expect(hits.map((h) => h.thread_id)).not.toContain('done')
    expect(hits.map((h) => h.thread_id)).not.toContain('old')
  })

  it('puts the recent match ahead of an older one', () => {
    add(1, 'o1', 'Thank you for your order', 'GoDaddy order total $20', NOW - 500 * DAY, 'GoDaddy <g@d.test>')
    add(1, 'o2', 'Thank you for your order', 'GoDaddy order total $35', NOW - 2 * DAY, 'GoDaddy <g@d.test>')
    expect(retrieveForAsk([1], 'GoDaddy order', 10, NOW)[0].thread_id).toBe('o2')
  })

  it('cleans the answer and lists only the sources it cites', async () => {
    expect(cleanAnswer('**2026** — done\n\n\n1. one\n* two')).toBe('2026, done\n\n- one\n- two')
    expect(citedNumbers('a [2], b [1, 3] and [2]')).toEqual([2, 1, 3])
    expect(spokenDate(Date.UTC(2026, 10, 6, 18), NOW)).toBe('Fri, Nov 6')
    expect(spokenDate(Date.UTC(2023, 7, 23, 18), NOW)).toBe('Wed, Aug 23, 2023')
    const none = await askMail(fakeAi(() => 'Your mail does not say.'), [1, 2], 'Acme invoice', NOW)
    expect(none.sources).toEqual([])
  })
})
