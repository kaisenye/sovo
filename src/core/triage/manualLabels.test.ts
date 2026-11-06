import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { classifyMessage } from '../ai/classify.js'
import { fakeAi } from '../services/ai/fake.js'
import { clearClassifications, saveClassification } from '../store/ai.js'
import { clearMessageLabels, saveAiLabel, setMessageLabels } from '../store/aiLabels.js'
import { closeDb, getDb, initDb } from '../store/db.js'
import { listView } from '../store/listRows.js'
import { upsertMessage } from '../store/repo.js'
import { IMPORTANT_ID, localLabelChoices, setLocalLabel } from './manualLabels.js'

let uid = 0
const put = (thread: string, date: number) =>
  upsertMessage({
    account_id: 1, folder_id: 1, uid: ++uid, message_id: `<${uid}@t>`, thread_id: thread, in_reply_to: null,
    from_addr: 'ann@x.test', from_name: 'Ann', to_addrs: '[]', cc_addrs: '[]', subject: 'Quote', date,
    snippet: 'hi', body_text: 'hi', body_fetched: 1, flags: '[]'
  })
const row = () => listView(1)[0]
const checked = (ids: number[]) => localLabelChoices(ids).filter((c) => c.checked).map((c) => c.label)
const ai = (cat: string, important = false) => ({ important, category: cat, reason: 'AI', model: 'm' })

let tooling = 0
beforeEach(() => {
  closeDb()
  initDb(join(mkdtempSync(join(tmpdir(), 'manual-')), 't.db'))
  uid = 0
  getDb().prepare("INSERT INTO accounts (id,email) VALUES (1,'me@x.test')").run()
  getDb().prepare("INSERT INTO folders (id,account_id,path,role) VALUES (1,1,'INBOX','inbox')").run()
  tooling = saveAiLabel({ accountId: 1, name: 'Tooling', description: 'Cutting tools' }).id
})

describe('labels set by hand', () => {
  it('offers Important, the categories and own labels on any inbox, checked where set', () => {
    const a = put('<q@t>', 1000)
    saveClassification(1, '<1@t>', ai('billing'))
    const labels = localLabelChoices([a]).map((c) => c.label)
    expect(labels.slice(0, 3)).toEqual(['Important', 'Personal', 'Work'])
    expect(labels).toContain('Tooling')
    expect(labels).not.toContain('Other')
    expect(checked([a])).toEqual(['Billing'])
  })

  it('replaces the category, and the AI never takes it back', async () => {
    const a = put('<q@t>', 1000)
    saveClassification(1, '<1@t>', ai('billing'))
    expect(setLocalLabel([a], 'sovo:cat:work', true)).toBe(1)
    expect(row().ai_category).toBe('work')
    expect(checked([a])).toEqual(['Work'])

    // The classifier writing again, a new reply's verdict, or switching it off.
    saveClassification(1, '<1@t>', ai('marketing'))
    const b = put('<q@t>', 2000)
    saveClassification(1, '<2@t>', ai('newsletter'))
    expect(row().ai_category).toBe('work')
    clearClassifications()
    expect(row().ai_category).toBe('work')

    // Nothing is asked for a thread the user labelled.
    const f = fakeAi(() => JSON.stringify({ important: true, category: 'support', reason: 'x' }))
    expect(await classifyMessage(f, b)).toBe(false)
    expect(f.calls).toHaveLength(0)

    setLocalLabel([a], 'sovo:cat:work', false)
    expect(row().ai_category).toBe('other')
  })

  it('toggles Important and own labels, which survive the classifier turning off', () => {
    const a = put('<q@t>', 1000)
    setLocalLabel([a], IMPORTANT_ID, true)
    setLocalLabel([a], 'sovo:own:tooling', true)
    expect(row().ai_important).toBe(1)
    expect(row().ai_labels).toContain('Tooling')
    // Switching the classifier off clears the labels job's verdicts, not the user's.
    const other = put('<z@t>', 500)
    setMessageLabels(1, '<2@t>', [tooling])
    expect(checked([other])).toEqual(['Tooling'])
    clearClassifications()
    clearMessageLabels()
    expect(checked([a])).toEqual(['Important', 'Tooling'])
    expect(checked([other])).toEqual([])
    setLocalLabel([a], 'sovo:own:tooling', false)
    setLocalLabel([a], IMPORTANT_ID, false)
    expect(checked([a])).toEqual([])
  })

  it('ignores ids it does not know', () => {
    const a = put('<q@t>', 1000)
    expect(setLocalLabel([a], 'sovo:cat:nope', true)).toBe(0)
    expect(setLocalLabel([a], 'Gmail/Label', true)).toBe(0)
  })
})
